import { loginSchema } from "@accessflow/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Container,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Navigate, Route, Routes } from "react-router-dom";
import type { z } from "zod";

type PublicUser = { id: string; displayName: string; email: string; role: string };
type SystemRow = { id: string; name: string; description: string };
type ProfileRow = { id: string; name: string; privileged: boolean };
type AccessRequest = {
  id: string;
  beneficiaryName: string;
  profileName: string;
  systemName: string;
  status: string;
  justification: string;
  assessment: { score: number; recommendation: string } | null;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    credentials: "include",
  });
  const body = (await response.json()) as T & { error?: { message: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Falha na API.");
  return body;
}

function LoginPage() {
  const queryClient = useQueryClient();
  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });
  const login = useMutation({
    mutationFn: (values: z.infer<typeof loginSchema>) =>
      api("/api/v1/auth/login", { method: "POST", body: JSON.stringify(values) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });

  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <Stack spacing={2}>
        <Typography variant="h4">AccessFlow</Typography>
        <Typography color="text.secondary">
          Laboratório local da Helios Indústria. O AccessGuard avalia o risco de cada pedido.
        </Typography>
        <Card>
          <CardContent>
            <Stack
              component="form"
              spacing={2}
              onSubmit={form.handleSubmit((values) => login.mutate(values))}
            >
              <TextField label="E-mail" {...form.register("email")} error={Boolean(form.formState.errors.email)} />
              <TextField
                label="Senha"
                type="password"
                {...form.register("password")}
                error={Boolean(form.formState.errors.password)}
              />
              {login.error ? <Alert severity="error">{login.error.message}</Alert> : null}
              <Button type="submit" variant="contained" disabled={login.isPending}>
                Entrar
              </Button>
            </Stack>
          </CardContent>
        </Card>
        <Typography variant="body2" color="text.secondary">
          Contas fictícias, senha Helios-demo-1: ana.costa, bruno.lima, clara.nunes e diego.alves em @helios.example.
        </Typography>
      </Stack>
    </Container>
  );
}

function HomePage({ user }: { user: PublicUser }) {
  const queryClient = useQueryClient();
  const [systemId, setSystemId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [justification, setJustification] = useState("");
  const health = useQuery({ queryKey: ["health"], queryFn: () => api<{ status: string; database: string }>("/health") });
  const systems = useQuery({
    queryKey: ["systems"],
    queryFn: () => api<{ data: SystemRow[] }>("/api/v1/systems"),
  });
  const profiles = useQuery({
    queryKey: ["profiles", systemId],
    enabled: Boolean(systemId),
    queryFn: () => api<{ data: ProfileRow[] }>(`/api/v1/systems/${systemId}/profiles`),
  });
  const requests = useQuery({
    queryKey: ["requests"],
    queryFn: () => api<{ data: AccessRequest[] }>("/api/v1/access-requests"),
  });
  const create = useMutation({
    mutationFn: () =>
      api("/api/v1/access-requests", {
        method: "POST",
        body: JSON.stringify({ profileId, justification }),
      }),
    onSuccess: () => {
      setJustification("");
      queryClient.invalidateQueries({ queryKey: ["requests"] });
    },
  });
  const decide = useMutation({
    mutationFn: (input: { id: string; action: "approve" | "reject"; justification?: string }) =>
      api(`/api/v1/access-requests/${input.id}/${input.action}`, {
        method: "POST",
        body: JSON.stringify(input.action === "reject" ? { justification: input.justification } : {}),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["requests"] }),
  });
  const logout = useMutation({
    mutationFn: () => api("/api/v1/auth/logout", { method: "POST", body: "{}" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });
  const canDecide = user.role === "manager" || user.role === "admin";

  return (
    <Container sx={{ py: 4 }}>
      <Stack spacing={3}>
        <Stack direction="row" sx={{ justifyContent: "space-between" }}>
          <Box>
            <Typography variant="h4">AccessFlow</Typography>
            <Typography color="text.secondary">
              {user.displayName} · {user.role} · API {health.data?.status ?? "..."} · banco {health.data?.database ?? "..."}
            </Typography>
          </Box>
          <Button onClick={() => logout.mutate()}>Sair</Button>
        </Stack>
        {health.data?.database === "down" ? (
          <Alert severity="warning">A API subiu, mas o MySQL não respondeu. Rode a migração e o seed.</Alert>
        ) : null}
        {user.role !== "security_analyst" ? (
          <Card>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6">Nova solicitação</Typography>
                <TextField select label="Sistema" value={systemId} onChange={(event) => setSystemId(event.target.value)}>
                  {(systems.data?.data ?? []).map((system) => (
                    <MenuItem key={system.id} value={system.id}>
                      {system.name}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField select label="Perfil" value={profileId} onChange={(event) => setProfileId(event.target.value)}>
                  {(profiles.data?.data ?? []).map((profile) => (
                    <MenuItem key={profile.id} value={profile.id}>
                      {profile.name}
                      {profile.privileged ? " (privilegiado)" : ""}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField label="Justificativa" value={justification} onChange={(event) => setJustification(event.target.value)} />
                {create.error ? <Alert severity="error">{create.error.message}</Alert> : null}
                <Button variant="contained" disabled={!profileId || justification.trim().length === 0} onClick={() => create.mutate()}>
                  Solicitar
                </Button>
              </Stack>
            </CardContent>
          </Card>
        ) : null}
        <Card>
          <CardContent>
            <Typography variant="h6">Solicitações</Typography>
            <Stack spacing={2} sx={{ mt: 2 }}>
              {(requests.data?.data ?? []).map((request) => (
                <Box key={request.id}>
                  <Typography>
                    {request.systemName} · {request.profileName} · {request.beneficiaryName} · {request.status}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {request.justification}
                    {request.assessment ? ` · risco ${request.assessment.score} (${request.assessment.recommendation})` : ""}
                  </Typography>
                  {canDecide && request.status === "pending_approval" ? (
                    <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                      <Button size="small" variant="contained" onClick={() => decide.mutate({ id: request.id, action: "approve" })}>
                        Aprovar
                      </Button>
                      <Button
                        size="small"
                        onClick={() =>
                          decide.mutate({
                            id: request.id,
                            action: "reject",
                            justification: "Fora da função da equipe.",
                          })
                        }
                      >
                        Recusar
                      </Button>
                    </Stack>
                  ) : null}
                </Box>
              ))}
              {(requests.data?.data ?? []).length === 0 ? <Typography>Nenhuma solicitação.</Typography> : null}
              {decide.error ? <Alert severity="error">{decide.error.message}</Alert> : null}
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </Container>
  );
}

export function App() {
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ user: PublicUser }>("/api/v1/auth/me"),
    retry: false,
  });

  if (me.isLoading) return <Typography sx={{ p: 4 }}>Carregando…</Typography>;

  return (
    <Routes>
      <Route path="/login" element={me.data ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/" element={me.data ? <HomePage user={me.data.user} /> : <Navigate to="/login" replace />} />
    </Routes>
  );
}
