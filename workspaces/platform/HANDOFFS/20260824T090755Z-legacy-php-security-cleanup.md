# Backend + Frontend Platform handoff: legacy-php-security-cleanup

- Created: 2026-08-24T09:07:55.010Z
- Branch: `scope/platform`
- Head: `9c9dc056e9a5f0b3dea05c113d3368aaf457eea3`
- Integration target: `integration/nexyfab`

## Summary

- Removed the remaining legacy PHP mail, search, and admin inquiry surfaces from the platform scope.
- Routed the public admin inquiry entry point to the authenticated `/admin/inquiries` Next.js page.
- This handoff freezes the platform-owned source change for integration; it does not claim release or deployment completion.

## Changed paths

- `adminlink/index.php`
- `public/search.php`
- `public/send-mail.php`
- `src/app/adminlink/page.tsx`
- `workspaces/platform/CURRENT.md`

## Verification

- [x] `npm run lint:ci`
- [x] `npm run typecheck`
- `npm run workspace:check -- platform` passed with the repository-pinned Node.js 22.23.2 and npm 10.9.8 toolchain.

## Remaining work and risks

- The integration-owned proxy and proxy regression test must explicitly deny `/adminlink/index.php` alongside the retired public PHP endpoints.
- Any legacy reCAPTCHA or mail credentials exposed to the retired PHP runtime require external credential rotation; repository deletion cannot complete that operational action.
- History rewrite, remote publication, deployment, and release remain on hold pending an explicit operator decision.
