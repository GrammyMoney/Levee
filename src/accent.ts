import type { Provider } from './contexts/SuiteContext';

// Accent color set, swapped per provider. LucidLink gets a neon-lime accent so
// you can tell at a glance you're navigating a LucidLink space; Suite (and any
// other managed drive) keeps the sky-blue accent.
export interface Accent {
  text: string;
  textStrong: string;
  hoverText: string;
  bg: string;
  bgSoft: string;
  hover: string;
  ring: string;
  dot: string;
  border: string;
}

const SKY: Accent = {
  text: 'text-sky-300',
  textStrong: 'text-sky-400',
  hoverText: 'hover:text-sky-400',
  bg: 'bg-sky-500/25',
  bgSoft: 'bg-sky-500/12',
  hover: 'hover:bg-sky-500/35',
  ring: 'ring-sky-400/40',
  dot: 'bg-sky-400',
  border: 'border-sky-400/30',
};

const LIME: Accent = {
  text: 'text-lime-300',
  textStrong: 'text-lime-400',
  hoverText: 'hover:text-lime-400',
  bg: 'bg-lime-400/25',
  bgSoft: 'bg-lime-400/12',
  hover: 'hover:bg-lime-400/35',
  ring: 'ring-lime-400/50',
  dot: 'bg-lime-400',
  border: 'border-lime-400/40',
};

export function accentFor(provider: Provider): Accent {
  return provider === 'lucidlink' ? LIME : SKY;
}

/** The action wording for a provider's cache operation. */
export function pinVerb(provider: Provider): { verb: string; done: string; remove: string } {
  return provider === 'lucidlink'
    ? { verb: 'Pin', done: 'Pinned', remove: 'Unpin' }
    : { verb: 'Pre-cache', done: 'Cached', remove: 'Remove from Pre-cache' };
}
