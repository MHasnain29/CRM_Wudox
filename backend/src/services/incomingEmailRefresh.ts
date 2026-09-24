import type { Request } from 'express';
import prisma from '../config/database';
import { getIO } from '../socket';
import { resolveEmailChipScope } from './emailChipScope';

/** Refresh recipients and connected viewers who can already read this mailbox. */
export async function emitIncomingEmailRefresh(subCompanyId: string, ownerIds: string[]): Promise<void> {
  const io = getIO();
  if (!io) return;
  const recipients = new Set(ownerIds);

  try {
    // Include linked identities: their sockets also join user:<id> rooms.
    const connectedIds = [...io.sockets.adapter.rooms.keys()]
      .filter((room) => room.startsWith('user:'))
      .map((room) => room.slice('user:'.length))
      .filter((id) => !recipients.has(id));
    if (connectedIds.length) {
      const viewers = await prisma.user.findMany({
        where: { id: { in: connectedIds }, isActive: true },
        select: { id: true, email: true, role: true, subCompanyId: true },
      });
      await Promise.all(viewers.map(async (viewer) => {
        try {
          const req = { user: {
            sub: viewer.id, email: viewer.email, role: viewer.role,
            subCompanyId: viewer.subCompanyId ?? '',
          } } as Request;
          // Reuse the list endpoint's agency/team access rules; a refresh grants no access.
          const scope = await resolveEmailChipScope(req, [subCompanyId], undefined);
          if (scope.agencyIds.includes(subCompanyId)
            && (scope.ownerIds === undefined || ownerIds.some((id) => scope.ownerIds!.includes(id)))) {
            recipients.add(viewer.id);
          }
        } catch (error) {
          console.error('[incomingEmailRefresh] Could not resolve viewer scope:', error);
        }
      }));
    }
  } catch (error) {
    // A refresh lookup must never fail an already-stored inbound delivery.
    console.error('[incomingEmailRefresh] Could not resolve connected viewers:', error);
  }

  // Union of rooms delivers once, even when one socket represents linked users.
  // Only invalidation metadata is sent; the UI re-fetches its exact selected scope.
  io.to([...recipients].map((id) => `user:${id}`)).emit('email:refresh', { subCompanyId });
}
