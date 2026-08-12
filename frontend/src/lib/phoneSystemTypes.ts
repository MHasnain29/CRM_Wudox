/**
 * Phone system bundle types — Settings → Phone System and call-flow builder.
 */

export type InboundCallOutcome =
  | 'answered'
  | 'no_answer'
  | 'voicemail'
  | 'abandoned'
  | 'busy'
  | 'failed';

export type FallbackAction = 'voicemail' | 'forward' | 'hangup';

export interface PhoneNumberRecord {
  id: string;
  e164: string;
  label: string;
  isActive: boolean;
  twilioIncomingSid?: string | null;
}

export interface MenuRoute {
  id: string;
  key: number;
  callerIdLabel: string;
  ringGroupId: string;
  ringGroupExtension: string;
  ringGroupName: string;
  dialTimeoutSec: number;
  voicemailBoxId: string;
  voicemailExtension: string;
  voicemailName: string;
  fallbackAction: FallbackAction;
  fallbackForwardE164: string;
}

export interface RingGroupMember {
  id: string;
  userId: string;
  userName: string;
  extension: string;
}

export interface RingGroup {
  id: string;
  extension: string;
  name: string;
  ringStrategy: 'simultaneous' | 'sequential';
  dialTimeoutSec: number;
  fallbackAction: FallbackAction;
  fallbackVoicemailBoxId: string;
  fallbackForwardE164: string;
  members: RingGroupMember[];
}

export interface StaffExtension {
  id: string;
  userId: string;
  userName: string;
  extension: string;
}

/** @deprecated Use StaffExtension — migrated on load. */
export interface DirectDialExtension {
  id: string;
  userId: string;
  userName: string;
  extension: string;
}

export interface VoicemailBox {
  id: string;
  extension: string;
  name: string;
  greetingType: 'unavailable' | 'busy' | 'custom';
  linkedMenuKey: number | null;
  notifyEmails: string[];
}

export type AudioClipSourceType = 'message' | 'upload';

export interface AudioClip {
  id: string;
  name: string;
  sourceType: AudioClipSourceType;
  scriptText: string;
  r2Key?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  durationSec: number;
  uploadedAt: string;
}

export interface BusinessHoursDay {
  dayOfWeek: number;
  label: string;
  enabled: boolean;
  open: string;
  close: string;
}

export interface ReadinessStep {
  id: number;
  task: string;
  howToVerify: string;
  passed: boolean;
}

export interface AgencyTwilioConfig {
  accountSid: string | null;
  apiKeySid: string | null;
  twimlAppSid: string | null;
  region: string | null;
  hasAuthToken: boolean;
  hasApiKeySecret: boolean;
  credentialsConfigured: boolean;
}

export function defaultAgencyTwilioConfig(): AgencyTwilioConfig {
  return {
    accountSid: null,
    apiKeySid: null,
    twimlAppSid: null,
    region: null,
    hasAuthToken: false,
    hasApiKeySecret: false,
    credentialsConfigured: false,
  };
}

export interface PhoneSystemConfig {
  syncStatus: 'not_connected' | 'synced' | 'error';
  lastSyncedAt: string | null;
  autoAttendantExtension: string;
  allowExtensionDialing: boolean;
  gatherTimeoutSec: number;
  greetingClipName: string;
  timeoutRouteLabel: string;
  invalidRouteLabel: string;
  providerType: 'twilio';
  webhookUrl: string;
  outboundCallerId?: string;
  outboundEnabled?: boolean;
  inboundEnabled?: boolean;
  timezone: string;
}

/** @deprecated Use PhoneNumberRecord */
export type DemoPhoneNumber = PhoneNumberRecord;
/** @deprecated Use MenuRoute */
export type DemoMenuRoute = MenuRoute;
/** @deprecated Use RingGroup */
export type DemoRingGroup = RingGroup;
/** @deprecated Use RingGroupMember */
export type DemoRingGroupMember = RingGroupMember;
/** @deprecated Use StaffExtension */
export type DemoStaffExtension = StaffExtension;
/** @deprecated Use DirectDialExtension */
export type DemoDirectDialExtension = DirectDialExtension;
/** @deprecated Use VoicemailBox */
export type DemoVoicemailBox = VoicemailBox;
/** @deprecated Use AudioClip */
export type DemoAudioClip = AudioClip;
/** @deprecated Use BusinessHoursDay */
export type DemoBusinessHoursDay = BusinessHoursDay;
/** @deprecated Use ReadinessStep */
export type DemoReadinessStep = ReadinessStep;
/** @deprecated Use PhoneSystemConfig */
export type DemoPhoneSystemState = PhoneSystemConfig;

export function defaultPhoneSystemConfig(webhookUrl = ''): PhoneSystemConfig {
  return {
    syncStatus: 'not_connected',
    lastSyncedAt: null,
    autoAttendantExtension: '112',
    allowExtensionDialing: true,
    gatherTimeoutSec: 5,
    greetingClipName: 'Greeting Options',
    timeoutRouteLabel: 'Menu timeout — please try again',
    invalidRouteLabel: 'Play Locations clip',
    providerType: 'twilio',
    webhookUrl,
    timezone: 'America/Toronto',
  };
}

export function defaultBusinessHours(): BusinessHoursDay[] {
  return [
    { dayOfWeek: 0, label: 'Sunday', enabled: false, open: '09:00', close: '17:00' },
    { dayOfWeek: 1, label: 'Monday', enabled: true, open: '09:00', close: '17:00' },
    { dayOfWeek: 2, label: 'Tuesday', enabled: true, open: '09:00', close: '17:00' },
    { dayOfWeek: 3, label: 'Wednesday', enabled: true, open: '09:00', close: '17:00' },
    { dayOfWeek: 4, label: 'Thursday', enabled: true, open: '09:00', close: '17:00' },
    { dayOfWeek: 5, label: 'Friday', enabled: true, open: '09:00', close: '17:00' },
    { dayOfWeek: 6, label: 'Saturday', enabled: false, open: '09:00', close: '17:00' },
  ];
}

export function countReadinessPassed(steps: ReadinessStep[]): number {
  return steps.filter((s) => s.passed).length;
}

export function newEntityId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
