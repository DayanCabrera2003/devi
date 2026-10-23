import type { ClaimTargets } from "../../core/services";
import type { RequestsManager } from "./service";

// Solicitudes (también traspasos) y respuestas que se pueden mandar a una sesión nueva con un código.
export const requestClaimTargets = (requests: RequestsManager): ClaimTargets => ({
  request: {
    check: (access, id) => requests.claimCheckRequest(access, id),
    deliverTo: (access, id, sessionId, details) => requests.deliverRequestToClaim(access, id, sessionId, details),
  },
  response: {
    check: (access, id) => requests.claimCheckResponse(access, id),
    deliverTo: (access, id, sessionId, details) => requests.deliverResponseToClaim(access, id, sessionId, details),
  },
});
