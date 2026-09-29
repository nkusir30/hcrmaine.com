# Home Care Residential website

A self-contained Node.js website for Home Care Residential. Its visual design and copy are original. Organization details, service descriptions, careers, employee portal names, and logo are based on the public Home Care Residential website and its linked pages.

## Run locally

From this directory:

```sh
npm install
npm start
```

Then open `http://127.0.0.1:4173`. Set `PORT` to choose another port. The server binds to loopback by default; production deployment must run behind HTTPS and set `HOST` to the interface required by the hosting platform. Stop the server with `Ctrl+C`.

## Deploy to Render

The `render.yaml` in this folder is designed to sit at the root of a dedicated private HCR website repository. Connect that repository in Render and create a Blueprint from `render.yaml`. The service runs `npm ci` and `npm start`, listens on Render's assigned `PORT`, and binds to `0.0.0.0`. The `starter` plan keeps the service available instead of relying on a free service that can spin down.

The Blueprint prompts for `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`. Enter these values only in Render's private environment-variable setup, using settings supplied by HCR's email administrator. Never add credentials to `render.yaml`, source control, or chat. `SMTP_FROM` must be an address authorized by the SMTP account. Until SMTP is configured, the site can serve pages, but online applications remain unavailable.

Deploy and verify the Render-provided `onrender.com` address before changing the production domain. Coordinate a controlled application-delivery test with HCR's email administrator; do not submit real applicant data as test data. After the website, PDFs, and application-delivery path are approved, add `hcrmaine.com` to Render and update only the DNS records Render specifies in DNSimple. Keep existing Microsoft 365 mail records (including MX and related verification records) unchanged. Keep the Durable service available until the new domain and HTTPS are verified and the rollback window has passed.

Render terminates public HTTPS and forwards requests through its trusted proxy. The deployment enables `TRUST_PROXY` so the application can apply its per-client submission limit using Render's forwarded client address.

## Verify

From this directory:

```sh
npm test
```

## Business information and external links

The website includes HCR's published address, phone numbers, public email, service descriptions, careers details, employee portal links, and logo. Employee Services uses keyboard-accessible tabs for Therap, Paychex, Evergreen, Attrezzo, and Maine Care Portal; each opens its supplied destination in a new tab. Confirm that these details and destinations remain current before deployment. Careers listings are not a guarantee of current openings. Career application links point to the HCR employment application on this site.

The HCR employment application can be submitted online or downloaded as a PDF for printing and offline completion. Below the application form, a **DSP MaineCare Background Checks** tab provides follow-up resources for applicants. It links to Maine's official Child Abuse Registry request service and signed authorization form, Maine OADS information for the Adult Protective Service clearance process, and the provided motor vehicle release authorization PDF. Maine's public APS online form reports suspected abuse, neglect, or exploitation; it is not an applicant clearance form. Applicants should complete and submit background-check requests through the State's process, not this website.

## Job application email configuration

The application endpoint sends validated applications to `info@hcrmaine.com` using authenticated SMTP over TLS. Each application can include up to three PDF, PNG, or JPEG certification/license files (2 MB each, 6 MB total). The server checks file type signatures and sizes, but it does not malware-scan attachments; the receiving mail provider should scan them. Set these variables in the hosting provider's private environment settings; never commit SMTP credentials or enter them in chat:

| Variable | Required | Description |
| --- | --- | --- |
| `SMTP_HOST` | Yes | SMTP server hostname from HCR's mail provider |
| `SMTP_PORT` | No | SMTP port; defaults to `587` |
| `SMTP_SECURE` | No | Set to `true` for implicit TLS, usually port `465`; otherwise STARTTLS is required |
| `SMTP_USER` | Yes | SMTP account username |
| `SMTP_PASS` | Yes | SMTP account password or app-specific password |
| `SMTP_FROM` | Yes | Verified sender address permitted by that SMTP account |
| `PORT` | No | HTTP listening port; defaults to `4173` |
| `HOST` | No | Bind address; defaults to `127.0.0.1` |
| `TRUST_PROXY` | No | Set to `true` only when the trusted hosting proxy safely sets `X-Forwarded-For` |

Until SMTP variables are configured, the endpoint returns an unavailable response and does not accept or retain applications. Ask HCR's email administrator for the provider's SMTP settings and have them configure the values directly in the hosting environment. The app does not save application data to disk or log it. It limits requests to five per client IP per hour, validates fields server-side, and rejects cross-origin submissions. If running behind a proxy, enable `TRUST_PROXY` only after confirming the proxy controls the forwarded-client header; configure additional edge rate limits at the host if available.

The application and any attachments are delivered as email, not stored in a protected applicant portal. Email may be retained, forwarded, or read by anyone with access to the `info@hcrmaine.com` inbox, and the website cannot enforce the mailbox's retention or access policies. Confirm HCR's email handling, attachment scanning, and applicant privacy practices before deployment. The form intentionally does not request Social Security numbers, government ID, health information, financial account details, citizenship, or criminal history.

The Contact Us form still prepares a message in the visitor's email application addressed to `hcr@hcrmaine.com`; it does not send or save those contact messages. Job applications use the separate server-side endpoint described above.
