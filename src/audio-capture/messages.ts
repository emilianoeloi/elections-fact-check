import { z } from 'zod';
import { Settings } from '../shared/schemas';

/** Comandos do service worker para o documento offscreen. */
export const OffscreenCommand = z.discriminatedUnion('type', [
  z.object({ target: z.literal('offscreen'), type: z.literal('capture-start'), streamId: z.string(), sessionId: z.string(), settings: Settings }),
  z.object({ target: z.literal('offscreen'), type: z.literal('capture-pause') }),
  z.object({ target: z.literal('offscreen'), type: z.literal('capture-resume') }),
  z.object({ target: z.literal('offscreen'), type: z.literal('capture-stop') }),
]);
export type OffscreenCommand = z.infer<typeof OffscreenCommand>;

/** Eventos do offscreen para o service worker. */
export const OffscreenEvent = z.discriminatedUnion('type', [
  z.object({ source: z.literal('offscreen'), type: z.literal('segment'), sessionId: z.string(), text: z.string(), offsetMs: z.number() }),
  z.object({ source: z.literal('offscreen'), type: z.literal('error'), sessionId: z.string(), message: z.string(), fatal: z.boolean() }),
  z.object({ source: z.literal('offscreen'), type: z.literal('ended'), sessionId: z.string() }),
]);
export type OffscreenEvent = z.infer<typeof OffscreenEvent>;

/** Comandos do painel para o service worker. */
export const PanelCommand = z.discriminatedUnion('type', [
  z.object({ source: z.literal('panel'), type: z.literal('start') }),
  z.object({ source: z.literal('panel'), type: z.literal('pause') }),
  z.object({ source: z.literal('panel'), type: z.literal('resume') }),
  z.object({ source: z.literal('panel'), type: z.literal('end') }),
  z.object({ source: z.literal('panel'), type: z.literal('reset') }),
  z.object({ source: z.literal('panel'), type: z.literal('recheck'), claimId: z.string() }),
  z.object({ source: z.literal('panel'), type: z.literal('ai-mode-opened'), claimId: z.string() }),
]);
export type PanelCommand = z.infer<typeof PanelCommand>;

export const STORAGE_KEYS = { session: 'fcl.session', settings: 'fcl.settings', target: 'fcl.target' } as const;
export const TargetTab = z.object({ tabId: z.number(), title: z.string(), url: z.string().optional() });
export type TargetTab = z.infer<typeof TargetTab>;
