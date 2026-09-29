const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const nodemailer = require('nodemailer');

const SITE_ROOT = __dirname;
const APPLICATION_INBOX = 'info@hcrmaine.com';
const MAX_APPLICATION_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 3;
const DEFAULT_RATE_LIMIT = Object.freeze({ limit: 5, windowMs: 60 * 60 * 1000 });
const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
]);

function isInsideSite(filePath) {
  const relativePath = path.relative(SITE_ROOT, filePath);
  return relativePath === '' || (!relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath));
}

function sendJson(response, status, body, extraHeaders = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

function isEmail(value) {
  return typeof value === 'string'
    && value.length <= 254
    && /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?$/i.test(value);
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  return cleaned.length > 0 && cleaned.length <= maxLength ? cleaned : null;
}

function cleanOptionalText(value, maxLength) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  return cleaned.length <= maxLength ? cleaned : null;
}

function validIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function normalizeAttachments(input) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > MAX_ATTACHMENT_COUNT) return null;

  let totalBytes = 0;
  const attachments = [];
  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const originalName = cleanText(item.name, 160);
    const filename = originalName?.replace(/\\/g, '/').split('/').pop()
      .replace(/[^A-Za-z0-9._-]/g, '_');
    const type = item.type;
    const base64 = item.contentBase64;
    const extension = filename?.split('.').pop()?.toLowerCase();
    const supported = (type === 'application/pdf' && extension === 'pdf')
      || (type === 'image/png' && extension === 'png')
      || (type === 'image/jpeg' && ['jpg', 'jpeg'].includes(extension));

    if (!filename || filename.length > 120 || !supported
      || typeof base64 !== 'string'
      || base64.length > Math.ceil(MAX_ATTACHMENT_BYTES * 4 / 3) + 4
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
      return null;
    }

    const content = Buffer.from(base64, 'base64');
    if (content.length === 0
      || content.length > MAX_ATTACHMENT_BYTES
      || content.toString('base64') !== base64) return null;
    totalBytes += content.length;
    if (totalBytes > MAX_ATTACHMENT_BYTES * MAX_ATTACHMENT_COUNT) return null;

    const hasValidSignature = (type === 'application/pdf' && content.subarray(0, 5).toString('ascii') === '%PDF-')
      || (type === 'image/png' && content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      || (type === 'image/jpeg' && content.length >= 3 && content[0] === 255 && content[1] === 216 && content[2] === 255);
    if (!hasValidSignature) return null;
    attachments.push({ filename, contentType: type, content });
  }

  return attachments;
}

function normalizeApplication(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (input.website) return null;

  const application = {
    firstName: cleanText(input.firstName, 80),
    middleName: cleanOptionalText(input.middleName, 80),
    lastName: cleanText(input.lastName, 80),
    email: isEmail(input.email) ? input.email.trim() : null,
    phone: cleanText(input.phone, 30),
    addressLine1: cleanText(input.addressLine1, 120),
    addressLine2: cleanOptionalText(input.addressLine2, 120),
    city: cleanText(input.city, 80),
    state: typeof input.state === 'string' && /^[A-Za-z]{2}$/.test(input.state.trim())
      ? input.state.trim().toUpperCase()
      : null,
    zip: typeof input.zip === 'string' && /^\d{5}(?:-\d{4})?$/.test(input.zip) ? input.zip : null,
    position: ['Direct Support Professional', 'Life Skills Development Coach'].includes(input.position)
      ? input.position
      : null,
    salaryDesired: cleanOptionalText(input.salaryDesired, 40),
    workedAtHcr: ['Yes', 'No'].includes(input.workedAtHcr) ? input.workedAtHcr : null,
    workedAtHcrWhen: cleanOptionalText(input.workedAtHcrWhen, 300),
    educationHighSchool: cleanText(input.educationHighSchool, 300),
    educationCollege: cleanOptionalText(input.educationCollege, 300),
    educationOther: cleanOptionalText(input.educationOther, 500),
    degreeObtained: ['Yes', 'No', 'In progress'].includes(input.degreeObtained) ? input.degreeObtained : null,
    trainings: Array.isArray(input.trainings)
      && input.trainings.length <= 12
      && input.trainings.every(item => ['CRMA', 'CPR/First Aid', 'CPI', 'DSP', 'Other'].includes(item))
      ? [...new Set(input.trainings)]
      : null,
    startDate: validIsoDate(input.startDate) ? input.startDate : null,
    availabilityDays: Array.isArray(input.availabilityDays)
      && input.availabilityDays.length > 0
      && input.availabilityDays.length <= 7
      && input.availabilityDays.every(day => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].includes(day))
      ? [...new Set(input.availabilityDays)]
      : null,
    availabilityShifts: Array.isArray(input.availabilityShifts)
      && input.availabilityShifts.length > 0
      && input.availabilityShifts.length <= 5
      && input.availabilityShifts.every(shift => ['Day', 'Evening', 'Night', 'Overnight', 'Weekend'].includes(shift))
      ? [...new Set(input.availabilityShifts)]
      : null,
    employmentHistory: cleanText(input.employmentHistory, 6000),
    professionalReferences: cleanText(input.professionalReferences, 4000),
    additionalNotes: cleanOptionalText(input.additionalNotes, 2000),
    attachments: normalizeAttachments(input.attachments),
    consent: input.consent === true ? true : null,
  };

  return Object.values(application).some(value => value === null) ? null : application;
}

function formatApplication(application) {
  return [
    'HOME CARE RESIDENTIAL - JOB APPLICATION',
    '',
    'APPLICANT',
    `Name: ${[application.firstName, application.middleName, application.lastName].filter(Boolean).join(' ')}`,
    `Email: ${application.email}`,
    `Phone: ${application.phone}`,
    `Address: ${[application.addressLine1, application.addressLine2, application.city, application.state, application.zip].filter(Boolean).join(', ')}`,
    `Position: ${application.position}`,
    `Salary desired: ${application.salaryDesired || 'Not provided'}`,
    `Worked at HCR before: ${application.workedAtHcr}`,
    `When: ${application.workedAtHcrWhen || 'Not provided'}`,
    '',
    'EDUCATION AND TRAINING',
    `High school / GED: ${application.educationHighSchool}`,
    `College / university: ${application.educationCollege || 'Not provided'}`,
    `Other education: ${application.educationOther || 'Not provided'}`,
    `Degree obtained: ${application.degreeObtained}`,
    `Training: ${application.trainings.join(', ') || 'None listed'}`,
    '',
    'AVAILABILITY',
    `Available to start: ${application.startDate}`,
    `Days: ${application.availabilityDays.join(', ')}`,
    `Shifts: ${application.availabilityShifts.join(', ')}`,
    '',
    'EMPLOYMENT HISTORY',
    application.employmentHistory,
    '',
    'PROFESSIONAL REFERENCES',
    application.professionalReferences,
    `Attached certificates/licenses: ${application.attachments.map(item => item.filename).join(', ') || 'None'}`,
    '',
    'ADDITIONAL NOTES',
    application.additionalNotes || 'None',
    '',
    'Applicant consented to submit this application by email.',
  ].join('\n');
}

function createApplicationMailer(env = process.env, createTransport = nodemailer.createTransport) {
  return async application => {
    const required = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
    const missing = required.filter(key => !env[key]);
    const port = Number(env.SMTP_PORT || 587);
    if (missing.length > 0 || !Number.isInteger(port) || port < 1 || port > 65535) {
      const error = new Error('Application email delivery is not configured.');
      error.code = 'EMAIL_NOT_CONFIGURED';
      throw error;
    }

    const transport = createTransport({
      host: env.SMTP_HOST,
      port,
      secure: env.SMTP_SECURE === 'true',
      requireTLS: env.SMTP_SECURE !== 'true',
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      tls: { minVersion: 'TLSv1.2' },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });

    await transport.sendMail({
      from: env.SMTP_FROM,
      to: APPLICATION_INBOX,
      replyTo: application.email,
      subject: 'Home Care Residential job application',
      text: formatApplication(application),
      attachments: application.attachments,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  };
}

function createRateLimiter(options = DEFAULT_RATE_LIMIT) {
  const attempts = new Map();
  return address => {
    const now = Date.now();
    const entry = attempts.get(address);
    if (!entry || now - entry.startedAt >= options.windowMs) {
      if (!entry && attempts.size >= 10_000) {
        for (const [key, value] of attempts) {
          if (now - value.startedAt >= options.windowMs) attempts.delete(key);
        }
        if (attempts.size >= 10_000) return false;
      }
      attempts.set(address, { startedAt: now, count: 1 });
      return true;
    }
    if (entry.count >= options.limit) return false;
    attempts.set(address, { ...entry, count: entry.count + 1 });
    return true;
  };
}

function getClientAddress(request, trustProxy) {
  if (trustProxy) {
    const forwardedFor = request.headers['x-forwarded-for'];
    const proxyClientAddress = typeof forwardedFor === 'string'
      ? forwardedFor.split(',').at(-1).trim()
      : '';
    if (net.isIP(proxyClientAddress)) return proxyClientAddress;
  }
  return request.socket.remoteAddress || 'unknown';
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const contentLength = request.headers['content-length'];
    if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_APPLICATION_BYTES)) {
      request.resume();
      reject(Object.assign(new Error('Payload too large.'), { status: 413 }));
      return;
    }

    const chunks = [];
    let bytes = 0;
    request.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_APPLICATION_BYTES) {
        request.resume();
        reject(Object.assign(new Error('Payload too large.'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Invalid JSON.'), { status: 400 }));
      }
    });
    request.on('error', () => reject(Object.assign(new Error('Request read failed.'), { status: 400 })));
  });
}

function createStaticServer(options = {}) {
  const sendApplication = options.sendApplication || createApplicationMailer(options.env);
  const rateLimit = createRateLimiter(options.rateLimit || DEFAULT_RATE_LIMIT);
  const trustProxy = options.trustProxy ?? process.env.TRUST_PROXY === 'true';
  const clientAddress = options.getClientAddress
    || (request => getClientAddress(request, trustProxy));

  return http.createServer((request, response) => {
    const pathnamePart = (request.url || '/').split('?')[0];
    if (pathnamePart === '/api/applications') {
      if (request.method !== 'POST') {
        response.writeHead(405, { Allow: 'POST' }).end('Method not allowed');
        return;
      }
      if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
        sendJson(response, 415, { error: 'Submit the application using the website form.' });
        return;
      }
      let origin;
      try {
        origin = new URL(request.headers.origin);
      } catch {
        sendJson(response, 403, { error: 'Application submissions must come from this website.' });
        return;
      }
      if (!['http:', 'https:'].includes(origin.protocol)
        || origin.origin !== request.headers.origin
        || origin.host !== request.headers.host) {
        sendJson(response, 403, { error: 'Application submissions must come from this website.' });
        return;
      }
      if (!rateLimit(clientAddress(request))) {
        sendJson(response, 429, { error: 'Too many applications were submitted. Please try again later.' }, {
          'Retry-After': '3600',
        });
        request.resume();
        return;
      }
      readJsonBody(request).then(normalizeApplication).then(async application => {
        if (!application) {
          sendJson(response, 400, { error: 'Please check the application fields and try again.' });
          return;
        }
        try {
          await sendApplication(application);
          sendJson(response, 202, { success: true });
        } catch (error) {
          if (error.code === 'EMAIL_NOT_CONFIGURED') {
            sendJson(response, 503, { error: 'Applications are not available yet. Please contact HCR by phone.' });
            return;
          }
          const errorCode = String(error.code || 'UNKNOWN').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
          console.error('Application email delivery failed:', errorCode);
          sendJson(response, 502, { error: 'Application could not be sent. Please try again later or contact HCR by phone.' });
        }
      }).catch(error => {
        sendJson(response, error.status || 400, {
          error: error.status === 413
            ? 'Application is too large to submit.'
            : 'Please check the application fields and try again.',
        });
      });
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent((request.url || '/').split('?')[0]);
    } catch {
      response.writeHead(400).end('Bad request');
      return;
    }

    if (pathname.includes('\0')) {
      response.writeHead(400).end('Bad request');
      return;
    }

    const requestedPath = pathname === '/' ? '/index.html' : pathname;
    const filePath = path.resolve(SITE_ROOT, `.${requestedPath}`);

    if (!isInsideSite(filePath)) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    fs.readFile(filePath, (error, content) => {
      if (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'EISDIR') {
          response.writeHead(404).end('Not found');
          return;
        }

        console.error('Unable to read requested site file:', error);
        response.writeHead(500).end('Internal server error');
        return;
      }

      const contentType = CONTENT_TYPES.get(path.extname(filePath)) || 'application/octet-stream';
      response.writeHead(200, {
        'Content-Type': contentType,
        'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
      });
      response.end(request.method === 'HEAD' ? undefined : content);
    });
  });
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid TCP port between 1 and 65535.');
  }
  return port;
}

if (require.main === module) {
  const port = parsePort(process.env.PORT || '4173');
  const server = createStaticServer();
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => {
    console.log(`Home Care Residential website listening on ${host}:${port}`);
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS || !process.env.SMTP_FROM) {
      console.warn('Job application email is not configured; application submissions will be disabled.');
    }
  });
  server.on('error', error => {
    console.error('Unable to start the local website server:', error);
    process.exitCode = 1;
  });
}

module.exports = {
  createApplicationMailer,
  createStaticServer,
  formatApplication,
  normalizeApplication,
  parsePort,
};
