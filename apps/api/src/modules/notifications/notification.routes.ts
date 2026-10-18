import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../common/errors/app-error.js';
import { PaginationQuery, skipOf, toPage } from '../../common/http/pagination.js';
import { mount, ObjectIdParam, route } from '../../common/http/route.js';
import { requireTenant } from '../../common/security/context.js';
import { NotificationModel } from './notification.model.js';

export function notificationRouter(): Router {
  const router = Router();
  mount(router, '/notifications', [
    route({
      method: 'get', path: '', tag: 'Notifications', summary: 'My notifications',
      query: PaginationQuery.extend({ unread: z.enum(['true', 'false']).optional() }),
      handler: async ({ ctx, query }) => {
        const filter: Record<string, unknown> = { tenantId: requireTenant(ctx), userId: ctx.userId };
        if (query.unread === 'true') filter.readAt = null;
        const [items, total, unread] = await Promise.all([
          NotificationModel.find(filter).sort({ createdAt: -1 }).skip(skipOf(query)).limit(query.pageSize),
          NotificationModel.countDocuments(filter),
          NotificationModel.countDocuments({ tenantId: requireTenant(ctx), userId: ctx.userId, readAt: null }),
        ]);
        return { ...toPage(items.map((n) => n.toJSON()), total, query), unread };
      },
    }),
    route({
      method: 'get', path: '/unread-count', tag: 'Notifications', summary: 'Number of unread notifications',
      handler: async ({ ctx }) => ({ unread: await NotificationModel.countDocuments({ tenantId: requireTenant(ctx), userId: ctx.userId, readAt: null }) }),
    }),
    route({
      method: 'post', path: '/:id/read', tag: 'Notifications', summary: 'Mark a notification as read', params: ObjectIdParam,
      handler: async ({ ctx, params }) => {
        const r = await NotificationModel.updateOne({ tenantId: requireTenant(ctx), userId: ctx.userId, _id: params.id }, { $set: { readAt: new Date() } });
        if (r.matchedCount === 0) throw AppError.notFound('Notification');
        return undefined;
      },
    }),
    route({
      method: 'post', path: '/read-all', tag: 'Notifications', summary: 'Mark all my notifications as read',
      handler: async ({ ctx }) => {
        await NotificationModel.updateMany({ tenantId: requireTenant(ctx), userId: ctx.userId, readAt: null }, { $set: { readAt: new Date() } });
        return undefined;
      },
    }),
  ]);
  return router;
}
