/**
 * The Kokoro voice catalogue.
 *
 * `grade` and `targetQuality` are Kokoro's own ratings, carried over from the
 * model card: target quality reflects the training audio, while the overall
 * grade also accounts for how much of it there was. They matter more here than
 * in most uses of TTS -- a wobble that passes in a paragraph becomes wearing
 * over ten hours -- so the descriptions below say plainly which voices hold up
 * for a full book.
 */
export type Voice = {
  id: string
  name: string
  accent: 'American' | 'British'
  gender: 'Female' | 'Male'
  /** Kokoro's overall grade, A (best) through F. */
  grade: string
  /** Kokoro's rating of the training audio. */
  targetQuality: string
  /** Kokoro's own trait markers. */
  traits?: string
  description: string
  /** Whether this voice holds up across a full-length book. */
  longForm: boolean
}

export const DEFAULT_VOICE = 'af_heart'

export const VOICES: Voice[] = [
  {
    id: 'af_heart',
    name: 'Heart',
    accent: 'American',
    gender: 'Female',
    grade: 'A',
    targetQuality: 'A',
    traits: '❤️',
    description:
      "Kokoro's flagship voice and the default here. The only voice in the set graded A on both the training audio and overall quality, and it shows: warm, even delivery with the steadiest pacing of any option. If you are narrating a whole novel and do not want to think about it, this is the one.",
    longForm: true
  },
  {
    id: 'af_bella',
    name: 'Bella',
    accent: 'American',
    gender: 'Female',
    grade: 'A-',
    targetQuality: 'A',
    traits: '🔥',
    description:
      'The strongest alternative to Heart, and the only other voice built on A-grade training audio. Slightly more animated and forward than Heart, with a touch more colour on emphasis. A good fit for fiction with a lot of dialogue; comfortably holds up over a full book.',
    longForm: true
  },
  {
    id: 'af_nicole',
    name: 'Nicole',
    accent: 'American',
    gender: 'Female',
    grade: 'B-',
    targetQuality: 'B',
    traits: '🎧',
    description:
      'Softer and closer-mic’d than the other American voices — Kokoro marks it with headphones, and it does sound like it was recorded for them. Quiet, intimate delivery that suits introspective first-person narration. Best heard through headphones rather than speakers.',
    longForm: true
  },
  {
    id: 'bf_emma',
    name: 'Emma',
    accent: 'British',
    gender: 'Female',
    grade: 'B-',
    targetQuality: 'B',
    traits: '🚺',
    description:
      'The strongest British voice in the set. Measured RP delivery, a little more formal than the American voices, and the most natural choice for British fiction or anything where an American accent would jar. Holds together well across long stretches.',
    longForm: true
  },
  {
    id: 'af_aoede',
    name: 'Aoede',
    accent: 'American',
    gender: 'Female',
    grade: 'C+',
    targetQuality: 'B',
    description:
      'A clear, fairly neutral American female voice. Perfectly listenable and a reasonable change of pace from Heart or Bella, but the mid grade shows up as occasional flatness on longer sentences. Fine for a few chapters; you may notice it wearing over a whole book.',
    longForm: false
  },
  {
    id: 'af_kore',
    name: 'Kore',
    accent: 'American',
    gender: 'Female',
    grade: 'C+',
    targetQuality: 'B',
    description:
      'Brighter and somewhat crisper than Aoede, with a little more attack on consonants. Good intelligibility, which helps with dense or technical prose, but the prosody is less reliable than the A-grade voices over long passages.',
    longForm: false
  },
  {
    id: 'af_sarah',
    name: 'Sarah',
    accent: 'American',
    gender: 'Female',
    grade: 'C+',
    targetQuality: 'B',
    description:
      'A conversational, slightly informal American female voice. Pleasant in short form and well suited to contemporary or YA fiction, though sentence endings can drift in pitch in a way that becomes noticeable at length.',
    longForm: false
  },
  {
    id: 'am_fenrir',
    name: 'Fenrir',
    accent: 'American',
    gender: 'Male',
    grade: 'C+',
    targetQuality: 'B',
    description:
      'The strongest male voice in the set, alongside Michael and Puck. Deeper and weightier than the others, which suits epic fantasy and darker material. Male voices in Kokoro are graded noticeably below the best female ones, so expect more variability.',
    longForm: false
  },
  {
    id: 'am_michael',
    name: 'Michael',
    accent: 'American',
    gender: 'Male',
    grade: 'C+',
    targetQuality: 'B',
    description:
      'A middle-register, even-tempered American male voice — the most neutral of the male options and the closest thing here to a conventional audiobook narrator. The best starting point if you want a male reader.',
    longForm: false
  },
  {
    id: 'am_puck',
    name: 'Puck',
    accent: 'American',
    gender: 'Male',
    grade: 'C+',
    targetQuality: 'B',
    description:
      'Lighter and more playful than Michael or Fenrir, with more movement in the delivery. Good for comic or irreverent prose; the same liveliness can read as unsteady in serious passages.',
    longForm: false
  },
  {
    id: 'af_alloy',
    name: 'Alloy',
    accent: 'American',
    gender: 'Female',
    grade: 'C',
    targetQuality: 'B',
    description:
      'A plain, businesslike American female voice with little inflection. The flat delivery makes it a reasonable pick for non-fiction or reference material, and a poor one for anything with dialogue.',
    longForm: false
  },
  {
    id: 'af_nova',
    name: 'Nova',
    accent: 'American',
    gender: 'Female',
    grade: 'C',
    targetQuality: 'B',
    description:
      'Similar in character to Alloy but a little warmer. Decent clarity, unremarkable expression, and audible strain on long or heavily punctuated sentences.',
    longForm: false
  },
  {
    id: 'bf_isabella',
    name: 'Isabella',
    accent: 'British',
    gender: 'Female',
    grade: 'C',
    targetQuality: 'B',
    description:
      'A second British female option, warmer and less formal than Emma. The lower grade shows in less consistent phrasing, so it is better suited to shorter pieces than to a full novel.',
    longForm: false
  },
  {
    id: 'bm_george',
    name: 'George',
    accent: 'British',
    gender: 'Male',
    grade: 'C',
    targetQuality: 'B',
    description:
      'The most solid British male voice. Dry, understated RP delivery that suits classic literature and period fiction. Steadier than the other British male options, though still short of the top American voices.',
    longForm: false
  },
  {
    id: 'bm_fable',
    name: 'Fable',
    accent: 'British',
    gender: 'Male',
    grade: 'C',
    targetQuality: 'B',
    traits: '🚹',
    description:
      'A storytelling British male voice with more lilt than George — the name is apt. Enjoyable for folklore and children’s fiction; the extra expressiveness costs some consistency.',
    longForm: false
  },
  {
    id: 'af_sky',
    name: 'Sky',
    accent: 'American',
    gender: 'Female',
    grade: 'C-',
    targetQuality: 'B',
    description:
      'A lighter, younger-sounding American female voice. Built on decent training audio but graded low overall, which tends to surface as thin tone and unstable endings. Worth a sample before committing to it.',
    longForm: false
  },
  {
    id: 'bm_lewis',
    name: 'Lewis',
    accent: 'British',
    gender: 'Male',
    grade: 'D+',
    targetQuality: 'C',
    description:
      'A gruffer British male voice. Noticeably rougher than George, with audible artifacts on sibilants. Usable for a short excerpt, not recommended for a book.',
    longForm: false
  },
  {
    id: 'af_jessica',
    name: 'Jessica',
    accent: 'American',
    gender: 'Female',
    grade: 'D',
    targetQuality: 'C',
    description:
      'Graded low on both training audio and overall quality. Expect flat prosody and occasional mispronunciation. Included for completeness rather than for listening at length.',
    longForm: false
  },
  {
    id: 'af_river',
    name: 'River',
    accent: 'American',
    gender: 'Female',
    grade: 'D',
    targetQuality: 'C',
    description:
      'A breathier American female voice with a distinctive character, undercut by a low grade. The texture is appealing in isolation but becomes tiring across a chapter.',
    longForm: false
  },
  {
    id: 'am_echo',
    name: 'Echo',
    accent: 'American',
    gender: 'Male',
    grade: 'D',
    targetQuality: 'C',
    description:
      'A quieter American male voice with a slightly hollow quality. Low grade, and it shows in uneven pacing. Better suited to short samples than sustained narration.',
    longForm: false
  },
  {
    id: 'am_eric',
    name: 'Eric',
    accent: 'American',
    gender: 'Male',
    grade: 'D',
    targetQuality: 'C',
    description:
      'A younger-sounding American male voice. Clear enough in short bursts, but the low grade produces noticeable inconsistency between sentences.',
    longForm: false
  },
  {
    id: 'am_liam',
    name: 'Liam',
    accent: 'American',
    gender: 'Male',
    grade: 'D',
    targetQuality: 'C',
    description:
      'A soft-spoken American male voice. The gentlest of the male options, but also among the least stable; long sentences tend to lose their footing.',
    longForm: false
  },
  {
    id: 'am_onyx',
    name: 'Onyx',
    accent: 'American',
    gender: 'Male',
    grade: 'D',
    targetQuality: 'C',
    description:
      'A deep American male voice aiming for gravitas. The low grade undercuts it — the bottom end is inconsistent and can sound muddy. Sample it before relying on it.',
    longForm: false
  },
  {
    id: 'bf_alice',
    name: 'Alice',
    accent: 'British',
    gender: 'Female',
    grade: 'D',
    targetQuality: 'C',
    traits: '🚺',
    description:
      'A light British female voice. Low grade throughout, with thin tone and unreliable emphasis. Of the British female voices, Emma is the substantially better choice.',
    longForm: false
  },
  {
    id: 'bf_lily',
    name: 'Lily',
    accent: 'British',
    gender: 'Female',
    grade: 'D',
    targetQuality: 'C',
    traits: '🚺',
    description:
      'A younger-sounding British female voice. Distinctive but low-graded, with audible artifacts on longer sentences. Better for a short reading than a book.',
    longForm: false
  },
  {
    id: 'bm_daniel',
    name: 'Daniel',
    accent: 'British',
    gender: 'Male',
    grade: 'D',
    targetQuality: 'C',
    traits: '🚹',
    description:
      'A restrained British male voice. Clear diction, but the low grade shows as stiffness and flat phrasing. George is the better British male option.',
    longForm: false
  },
  {
    id: 'am_santa',
    name: 'Santa',
    accent: 'American',
    gender: 'Male',
    grade: 'D-',
    targetQuality: 'C',
    description:
      'A novelty voice — older, jollier, and clearly built for seasonal use. Near the bottom of the ratings. Fun for a paragraph, unsuited to a book.',
    longForm: false
  },
  {
    id: 'am_adam',
    name: 'Adam',
    accent: 'American',
    gender: 'Male',
    grade: 'F+',
    targetQuality: 'D',
    description:
      'The lowest-graded voice in the set, on both counts. Expect obvious artifacts and unstable prosody throughout. Present for completeness; pick almost anything else.',
    longForm: false
  }
]

const BY_ID = new Map(VOICES.map((voice) => [voice.id, voice]))

export function findVoice(id: string): Voice | undefined {
  return BY_ID.get(id)
}

export function voiceIds(): string[] {
  return VOICES.map((voice) => voice.id)
}

/** Voices that hold up across a full-length book, best first. */
export function longFormVoices(): Voice[] {
  return VOICES.filter((voice) => voice.longForm)
}
