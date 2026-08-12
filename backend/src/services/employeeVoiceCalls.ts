/**
 * Place an outbound voice call record linked to an Employee (not a Client).
 * Twilio bridging reuses the existing connectOutboundCall / webhook path by call id.
 */
import { CallOutcome } from '@prisma/client';
import prisma from '../config/database';
import { getAgencyVoiceConfig } from './phoneSystemService';
import { outboundConferenceRoomFor } from './conferenceBridge';

export type PlaceEmployeeCallInput = {
  to: string;
  employeeId: string;
  subCompanyId: string;
  ownerId: string;
  ownerName: string;
};

export type PlaceEmployeeCallResult =
  | { ok: true; callId: string }
  | { ok: false; status: number; error: string; message?: string };

export async function placeEmployeeOutboundCall(
  input: PlaceEmployeeCallInput,
): Promise<PlaceEmployeeCallResult> {
  const normalized = input.to.replace(/\D/g, '');
  if (normalized.length < 10) {
    return { ok: false, status: 400, error: 'Invalid phone number' };
  }

  const employee = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true, firstName: true, lastName: true, phone: true },
  });
  if (!employee) {
    return { ok: false, status: 404, error: 'Employee not found' };
  }

  const agencyVoice = await getAgencyVoiceConfig(input.subCompanyId);
  if (!agencyVoice.outboundEnabled) {
    return {
      ok: false,
      status: 403,
      error: 'Outbound calling disabled',
      message: 'Enable outbound calling in Settings → Phone System → Number.',
    };
  }
  if (!agencyVoice.outboundCallerId) {
    return {
      ok: false,
      status: 503,
      error: 'Agency phone number not configured',
      message: 'Set your agency number in Settings → Phone System → Number.',
    };
  }

  const callRecord = await prisma.call.create({
    data: {
      clientId: null,
      employeeId: employee.id,
      subCompanyId: input.subCompanyId,
      ownerId: input.ownerId,
      outcome: CallOutcome.initiated,
    },
  });

  await prisma.call.update({
    where: { id: callRecord.id },
    data: { conferenceRoom: outboundConferenceRoomFor(callRecord.id) },
  });

  const employeeName = `${employee.firstName} ${employee.lastName}`.trim() || 'Employee';
  await prisma.activityLog.create({
    data: {
      type: 'call',
      userId: input.ownerId,
      userName: input.ownerName,
      subCompanyId: input.subCompanyId,
      description: `Outbound call placed to employee ${employeeName}`,
      metadata: {
        callId: callRecord.id,
        employeeId: employee.id,
        outcome: 'initiated',
      },
    },
  });

  return { ok: true, callId: callRecord.id };
}
