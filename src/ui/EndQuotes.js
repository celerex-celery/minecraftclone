/**
 * End credits quotes.
 *
 * These are shown during the end credits sequence when returning from the End.
 * Picked randomly and scrolled through with the credits music.
 */

export const END_QUOTES = [
  'The End is only the beginning',
  'Every journey must come to an end',
  'You cannot stay in the End forever',
  'The dragon is dead, but the void remains',
  'All worlds end eventually',
  'The credits roll, the music fades',
  'You were the hero this world needed',
  'But heroes do not get happy endings',
  'The islands drift apart in the void',
  'End stone remembers every footstep',
  'The crystals sing a lullaby for the dead',
  'Obsidian pillars stand as silent monuments',
  'The portal home is a wound in reality',
  'You leave behind only echoes',
  'The End does not forget its visitors',
  'A world without end is a world without meaning',
  'The dragon\'s breath still lingers in the air',
  'Bedrock cannot be broken, only endured',
  'The void stares back, patient and infinite',
  'You came, you saw, you conquered nothing',
  'The credits are the only truth',
  'Every block placed was a moment lived',
  'Every block broken was a moment lost',
  'The End poem was never written for you',
  'Wake up',
  'The game was never about winning',
  'It was about the blocks you placed along the way',
  'The End is not a place. It is a feeling.',
  'You are not the player. You are the dream.',
  'And the dream must end.',
  'Goodbye, traveler.',
  'The void thanks you for your visit.',
  'Your inventory will be emptied. Your memories will not.',
  'The dragon watches from beyond the credits.',
  'Endermen weep for the world they cannot have.',
  'The chorus plays. The screen goes dark.',
  'You will wake up in your bed. Or you will not.',
  'The End is the only honest place in Minecraft.',
  'Everything else is just blocks.',
  'But these blocks... these blocks meant something.',
  'Didn\'t they?',
  'The music slows. The quotes stop.',
  'The screen goes black.',
  'You are alone again.',
  'As you always were.',
  'As you always will be.',
  'The End.',
];

export function randomEndQuote(active = END_QUOTES) {
  return active[(Math.random() * active.length) | 0];
}