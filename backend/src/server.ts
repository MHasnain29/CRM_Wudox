import './loadEnv';
import { createServer } from 'http';
import fs from 'fs';
import path from 'path';
import express, { Request, Response } from 'express';
import helmet from 'helmet';
import { attachSocketIO } from './socket';
import cors from 'cors';
import { corsOriginDelegate } from './config/corsOrigins';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import prisma from './config/database';
import { connectRedis, disconnectRedis } from './config/redis';
import { authRouter } from './routes/auth';
import { clientRouter } from './routes/clients';
import { leadsRouter } from './routes/leads';
import { leadRequestsRouter } from './routes/leadRequests';
import { leadReassignmentRequestsRouter } from './routes/leadReassignmentRequests';
import { documentsRouter } from './routes/documents';
import { tasksRouter } from './routes/tasks';
import { followUpsRouter } from './routes/followUps';
import { userRouter } from './routes/users';
import { voiceRouter } from './routes/voice';
import { phoneSystemRouter } from './routes/phoneSystem';
import { ipRestrictionRulesRouter } from './routes/ipRestrictionRules';
import { messagesRouter } from './routes/messages';
import { internalCallsRouter } from './routes/internalCalls';
import { notificationsRouter } from './routes/notifications';
import { emailsRouter } from './routes/emails';
import { emailTemplatesRouter } from './routes/emailTemplates';
import { emailSignaturesRouter } from './routes/emailSignatures';
import { settingsRouter } from './routes/settings';
import { approvalsRouter } from './routes/approvals';
import { activityLogsRouter } from './routes/activityLogs';
import { dashboardRouter } from './routes/dashboard';
import { dailyActivityRouter } from './routes/dailyActivity';
import { bugReportsRouter } from './routes/bugReports';
import proposalsRouter from './routes/proposals';
import reviewTemplatesRouter from './routes/reviewTemplates';
import { meetingsRouter } from './routes/meetings';
import { bookedMeetingsRouter } from './routes/bookedMeetings';
import { ipAllowlist } from './middleware/ipAllowlist';
import { startTaskDueChecker, stopTaskDueChecker } from './jobs/taskDueChecker';
import { startClientVisibilityPromoter, stopClientVisibilityPromoter } from './jobs/clientVisibilityPromoter';
import { startClientApprovalAutoApprover, stopClientApprovalAutoApprover } from './jobs/clientApprovalAutoApprover';
import { startMeetingReminderChecker, stopMeetingReminderChecker } from './jobs/meetingReminderChecker';
import { startDailyReportEmailer, stopDailyReportEmailer } from './jobs/dailyReportEmailer';
import { startActivityTimeoutEvaluator, stopActivityTimeoutEvaluator } from './jobs/activityTimeoutEvaluator';
import { startCampaignScheduler, stopCampaignScheduler } from './jobs/campaignScheduler';
import { startSendGridSync, stopSendGridSync } from './jobs/sendgridSyncJob';
import { startCampaignStatsRefresher, stopCampaignStatsRefresher } from './jobs/campaignStatsRefresher';
import { startOutboundEmailQueueProcessor, stopOutboundEmailQueueProcessor } from './jobs/outboundEmailQueueProcessor';
import { activityRouter } from './routes/activity';
import { campaignsRouter } from './routes/campaigns';
import { webhooksRouter } from './routes/webhooks';
import { mailingListsRouter } from './routes/mailingLists';
import { unsubscribeRouter } from './routes/unsubscribe';
import { pandaDocRouter } from './routes/pandadoc';
import { performanceReportRouter } from './routes/performanceReport';
import { databaseManagerReportRouter } from './routes/databaseManagerReport';
import { publicRouter } from './routes/public';
import { rolesRouter } from './routes/roles';
import { remarksRouter } from './routes/remarks';
import { clientNoteFieldsRouter, clientNoteFieldValuesRouter } from './routes/clientNoteFields';
import offboardingRouter from './routes/offboarding';
import agencyLinkRouter from './routes/agencyLink';
import { employeesRouter } from './routes/employees';
import { activeClientTrainingRouter } from './routes/activeClientTraining';
import { activeClientsRouter } from './routes/activeClients';
import { jobsRouter } from './routes/jobs';
import { projectsRouter } from './routes/projects';
import { leaveRouter } from './routes/leave';
import noticesRouter from './routes/notices';
import { attendanceRouter } from './routes/attendance';

const app = express();

if (env.TRUST_PROXY === 'true' || env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}

/** Rate-limit key: some proxies set X-Forwarded-For / req.ip to "ipv4:port", which breaks express-rate-limit's IP check. */
function rateLimitClientKey(req: Request): string {
  const xff = req.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim() ?? '';
    const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/;
    const m = first.match(v4WithPort);
    if (m) return m[1];
    if (first) return first;
  }
  const raw = req.ip || req.socket?.remoteAddress || 'unknown';
  if (typeof raw !== 'string') return 'unknown';
  const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/;
  const m2 = raw.match(v4WithPort);
  if (m2) return m2[1];
  return raw;
}

// Security: IP allowlist (optional), helmet, cors, rate-limit
app.use(ipAllowlist);
app.use(
  helmet({
    contentSecurityPolicy:
      env.NODE_ENV === 'production'
        ? {
            directives: {
              ...helmet.contentSecurityPolicy.getDefaultDirectives(),
              // Twilio Voice JS SDK: fetches sounds from sdk.twilio.com, signaling via wss://*.twilio.com
              'connect-src': [
                "'self'",
                'https://sdk.twilio.com',
                'https://*.twilio.com',
                'wss://*.twilio.com',
                'wss://voice-js.roaming.twilio.com',
              ],
              'media-src': ["'self'", 'https://sdk.twilio.com', 'blob:', 'data:'],
              'frame-src': ["'self'", 'blob:', 'data:'],
            },
          }
        : false,
  })
);
app.use(cors({
  origin: corsOriginDelegate,
  credentials: true,
}));
if (env.NODE_ENV !== 'development') {
  app.use(
    rateLimit({
      windowMs: parseInt(env.RATE_LIMIT_WINDOW_MS),
      limit: parseInt(env.RATE_LIMIT_MAX_REQUESTS),
      standardHeaders: true,
      legacyHeaders: false,
      // Disable all built-in checks: proxies often set req.ip to "a.b.c.d:port", which fails net.isIP() inside the default key path in some versions/setups.
      validate: false,
      keyGenerator: (req) => rateLimitClientKey(req),
    })
  );
}
// Allow larger payloads for document uploads (base64 in JSON). Default is ~100kb.
const jsonLimit = process.env.BODY_LIMIT ?? '50mb';
app.use(express.json({
  limit: jsonLimit,
  verify: (req: any, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: true, limit: jsonLimit })); // Twilio webhooks send form-urlencoded

// Global audit logging: persist all write operations (POST/PATCH/PUT/DELETE).
// Stores minimal metadata (no secrets, no base64 bodies) for reporting and compliance.
app.use((req: Request, res: Response, next) => {
  const start = Date.now();
  const method = (req.method || '').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

  res.on('finish', () => {
    const user = req.user;
    if (!user?.sub || !user.subCompanyId) return;

    const redactKeys = new Set([
      'password',
      'newPassword',
      'refreshToken',
      'token',
      'authToken',
      'apiKeySecret',
      'googleRefreshToken',
      'twilioAuthToken',
      'twilioApiKeySecret',
      'fileBase64',
      'trainingFileBase64',
      'screenshotBase64',
      'content', // message/email bodies can be large; keep keys only
      'html',
      'text',
    ]);

    const bodyKeys =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? Object.keys(req.body).filter((k) => !redactKeys.has(k)).slice(0, 50)
        : undefined;

    const meta = {
      method,
      path: req.path,
      originalUrl: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
      ip: req.ip,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
      contentLength: typeof req.headers['content-length'] === 'string' ? req.headers['content-length'] : undefined,
      bodyKeys,
      queryKeys: req.query && typeof req.query === 'object' ? Object.keys(req.query).slice(0, 50) : undefined,
      paramsKeys: req.params && typeof req.params === 'object' ? Object.keys(req.params).slice(0, 50) : undefined,
    };

    void prisma.activityLog
      .create({
        data: {
          type: 'audit',
          userId: user.sub,
          userName: user.email ?? 'Unknown',
          subCompanyId: user.subCompanyId,
          description: `${method} ${req.path} → ${res.statusCode}`,
          metadata: meta,
        },
      })
      .catch(() => {
        // Never fail request because of logging
      });
  });

  next();
});

// Health and API info (no auth)
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});
app.get(`${env.API_PREFIX}/${env.API_VERSION}`, (_req: Request, res: Response) => {
  res.json({
    message: 'NA Staffing CRM API',
    version: env.API_VERSION,
    status: 'running',
  });
});

// API routes
const prefix = `${env.API_PREFIX}/${env.API_VERSION}`;
app.use(`${prefix}/public`, publicRouter);
app.use(`${prefix}/auth`, authRouter);
app.use(`${prefix}/agency-links`, agencyLinkRouter);
app.use(`${prefix}/roles`, rolesRouter);
app.use(`${prefix}/client-note-fields`, clientNoteFieldsRouter);
// Per-client note field values: nested under /clients/:id/note-fields
app.use(`${prefix}/clients/:id/note-fields`, clientNoteFieldValuesRouter);
app.use(`${prefix}/clients`, clientRouter);
app.use(`${prefix}/remarks`, remarksRouter);
app.use(`${prefix}/leads`, leadsRouter);
app.use(`${prefix}/lead-requests`, leadRequestsRouter);
app.use(`${prefix}/lead-reassignment-requests`, leadReassignmentRequestsRouter);
app.use(`${prefix}/documents`, documentsRouter);
app.use(`${prefix}/tasks`, tasksRouter);
app.use(`${prefix}/follow-ups`, followUpsRouter);
app.use(`${prefix}/users`, userRouter);
app.use(`${prefix}/voice`, voiceRouter);
app.use(`${prefix}/phone-system`, phoneSystemRouter);
app.use(`${prefix}/messages`, messagesRouter);
  app.use(`${prefix}/internal-calls`, internalCallsRouter);
app.use(`${prefix}/notifications`, notificationsRouter);
app.use(`${prefix}/emails`, emailsRouter);
app.use(`${prefix}/email-templates`, emailTemplatesRouter);
app.use(`${prefix}/email-signatures`, emailSignaturesRouter);
app.use(`${prefix}/settings`, settingsRouter);
app.use(`${prefix}/approvals`, approvalsRouter);
app.use(`${prefix}/activity-logs`, activityLogsRouter);
app.use(`${prefix}/dashboard`, dashboardRouter);
app.use(`${prefix}/daily-activity`, dailyActivityRouter);
app.use(`${prefix}/bug-reports`, bugReportsRouter);
app.use(`${prefix}/ip-restriction-rules`, ipRestrictionRulesRouter);
app.use(`${prefix}/proposals`, proposalsRouter);
app.use(`${prefix}/review-templates`, reviewTemplatesRouter);
app.use(`${prefix}/meetings`, meetingsRouter);
app.use(`${prefix}/booked-meetings`, bookedMeetingsRouter);
app.use(`${prefix}/activity`, activityRouter);
app.use(`${prefix}/campaigns`, campaignsRouter);
app.use(`${prefix}/lists`, mailingListsRouter);
// Webhook routes — no auth middleware, called directly by SendGrid / PandaDoc
app.use(`${prefix}/webhooks`, webhooksRouter);
// Public unsubscribe — no auth, called via link in campaign emails
app.use(`${prefix}/unsubscribe`, unsubscribeRouter);
app.use(`${prefix}/pandadoc`, pandaDocRouter);
app.use(`${prefix}/reports`, performanceReportRouter);
app.use(`${prefix}/reports`, databaseManagerReportRouter);
app.use(`${prefix}/offboarding`, offboardingRouter);
app.use(`${prefix}/employees`, employeesRouter);
app.use(`${prefix}/employees`, activeClientTrainingRouter);
app.use(`${prefix}/active-clients`, activeClientsRouter);
app.use(`${prefix}/jobs`, jobsRouter);
app.use(`${prefix}/projects`, projectsRouter);
app.use(`${prefix}/leave`, leaveRouter);
app.use(`${prefix}/notices`, noticesRouter);
app.use(`${prefix}/attendance`, attendanceRouter);

// Serve frontend build from backend/client (copy frontend/dist contents into backend/client)
const clientDir = path.join(__dirname, '..', 'client');
if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir));
  // SPA fallback: serve index.html for non-API GET so client-side routing works
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(clientDir, 'index.html'));
  });
}

const start = async () => {
  try {
    await prisma.$connect();
    console.log('✅ Database connected');

    const { ensureSystemRbacRoles } = await import('./services/rbacBootstrap');
    await ensureSystemRbacRoles();

    const { clearStaleAgencyIndependentHomeAgencies } = await import('./services/agencyIndependentUsers');
    const cleared = await clearStaleAgencyIndependentHomeAgencies();
    if (cleared > 0) {
      console.log(`[startup] Cleared home agency for ${cleared} org-wide user(s)`);
    }

    await connectRedis();

    const httpServer = createServer(app);
    attachSocketIO(httpServer);

    startTaskDueChecker();
    startClientVisibilityPromoter();
    startClientApprovalAutoApprover();
    startMeetingReminderChecker();
    startDailyReportEmailer();
    startActivityTimeoutEvaluator();
    startCampaignScheduler();
    startSendGridSync();
    startCampaignStatsRefresher();
    startOutboundEmailQueueProcessor();

    const port = parseInt(env.PORT);
    httpServer.listen(port, '0.0.0.0', () => {
      console.log(`🚀 Server listening on http://0.0.0.0:${port}`);
      console.log(`📚 API: http://0.0.0.0:${port}${prefix}`);
      console.log(`🔌 Socket.IO: /socket.io`);
    });
  } catch (err) {
    console.error(err);
    await prisma.$disconnect();
    await disconnectRedis();
    process.exit(1);
  }
};

const shutdown = async () => {
  console.log('\n🛑 Shutting down gracefully...');
  stopTaskDueChecker();
  stopClientVisibilityPromoter();
  stopClientApprovalAutoApprover();
  stopMeetingReminderChecker();
  stopDailyReportEmailer();
  stopActivityTimeoutEvaluator();
  stopCampaignScheduler();
  stopSendGridSync();
  stopCampaignStatsRefresher();
  stopOutboundEmailQueueProcessor();
  await prisma.$disconnect();
  await disconnectRedis();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
