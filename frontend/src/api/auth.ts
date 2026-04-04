import { apiFetch } from "./client";
import type { LoginResponse } from "../types";

export function login(username: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username }),
  });
}
