import { API } from "@devi/protocol";
import { readBody } from "../../core/body";
import { json } from "../../core/http";
import type { Router } from "../../core/router";
import type { ClaimsManager } from "./service";

export function registerClaimRoutes(r: Router, claims: ClaimsManager): void {
  r.on(API.createClaim, async ({ request, access }) => json(claims.create(access, (await readBody(request, API.createClaim.body)).target)));
  r.on(API.cancelClaim, ({ params, access }) => {
    claims.cancel(access, params.code!);
    return json({ ok: true });
  });
  r.on(API.myClaims, ({ access }) => json(claims.mine(access.memberId)));
  r.on(API.redeemClaim, async ({ request, access }) => json({ delivery: claims.redeem(access, await readBody(request, API.redeemClaim.body)) }));
}
