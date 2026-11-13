/**
 * The starter loops (TODO "Starter loops"): shipped as data. Each is one
 * sentence with blanks; the user fills the blanks, nothing else.
 */
import type {Every} from './loops';

export interface LoopTemplate {
  id: string;
  title: string;
  /** One line for the gallery card. */
  oneLine: string;
  blanks: {key: string; label: string; example: string}[];
  /** {{key}} is replaced by the user's text for that blank. */
  prompt: string;
  every: Every;
  at?: {hour: number; minute: number};
  maxRuns: number;
  days: number;
  /** What it may use, in plain words. */
  uses: string;
}

export const LOOP_TEMPLATES: LoopTemplate[] = [
  {
    id: 'goal-planner',
    title: 'Goal planner',
    oneLine: 'Breaks a goal into small steps and offers the next one each day.',
    blanks: [
      {key: 'goal', label: 'Your goal', example: 'clean the garage'},
      {key: 'time', label: 'Time you have each day', example: '20 minutes'},
    ],
    prompt:
      'My goal: {{goal}}. I have {{time}} a day. On the first run, break it into 5 to 7 small, concrete steps and list them. On later runs, ask what I got done, tick off finished steps, and give me the next step that fits the time I have.',
    every: 'day',
    at: {hour: 8, minute: 0},
    maxRuns: 14,
    days: 14,
    uses: 'The model only.',
  },
  {
    id: 'morning-brief',
    title: 'Morning brief',
    oneLine: 'Three things to do first today, from your notes and memory.',
    blanks: [
      {
        key: 'focus',
        label: 'What matters most now',
        example: 'work and the move',
      },
    ],
    prompt:
      'Give me a short morning brief. What matters most to me right now: {{focus}}. Use my memory notes if you have them, and the date and time. Suggest the three things to do first today.',
    every: 'day',
    at: {hour: 7, minute: 0},
    maxRuns: 14,
    days: 14,
    uses: 'Memory (read) and the date, if switched on.',
  },
  {
    id: 'evening-review',
    title: 'Evening review',
    oneLine: 'What went well, what is left, and tomorrow’s first step.',
    blanks: [{key: 'area', label: 'Review what', example: 'my day at work'}],
    prompt:
      'Help me review {{area}}. Ask me what went well and what is left (I will answer in this chat), then suggest tomorrow’s first steps. If I want them saved to memory, ask first.',
    every: 'day',
    at: {hour: 20, minute: 0},
    maxRuns: 14,
    days: 14,
    uses: 'The model; memory only if you say yes.',
  },
  {
    id: 'habit-check-in',
    title: 'Habit check-in',
    oneLine: 'A daily question about a habit, a streak and a gentle next step.',
    blanks: [{key: 'habit', label: 'The habit', example: 'a 10-minute walk'}],
    prompt:
      'Check in on my habit: {{habit}}. Ask whether I did it today, keep count of my streak from earlier in this chat, and suggest one small way to make tomorrow easier.',
    every: 'day',
    at: {hour: 19, minute: 0},
    maxRuns: 30,
    days: 30,
    uses: 'The model only.',
  },
  {
    id: 'learn-something',
    title: 'Learn something',
    oneLine: 'A short lesson a day, with a quiz question.',
    blanks: [{key: 'topic', label: 'Topic', example: 'Spanish basics'}],
    prompt:
      'Teach me {{topic}}, one short lesson per run. Build on earlier lessons and on my answers in this chat. End the lesson with one quiz question.',
    every: 'day',
    at: {hour: 18, minute: 0},
    maxRuns: 14,
    days: 14,
    uses: 'The model only.',
  },
  {
    id: 'focus-timer',
    title: 'Focus check-in',
    oneLine: 'Every hour: what got done, and the next small step.',
    blanks: [
      {key: 'task', label: 'What you are working on', example: 'my report'},
    ],
    prompt:
      'I am working on {{task}}. Ask what I got done since the last check-in and suggest the next small step, sized for under an hour.',
    every: 'hour',
    maxRuns: 8,
    days: 1,
    uses: 'The model only.',
  },
  {
    id: 'watch-a-page',
    title: 'Watch a page',
    oneLine: 'Reads a web page every few hours and says what changed.',
    blanks: [
      {key: 'url', label: 'Page address', example: 'https://example.com/news'},
      {key: 'what', label: 'What to look for', example: 'new posts'},
    ],
    prompt:
      'Read the page {{url}} and look for {{what}}. Compare with what you found earlier in this chat and tell me only what changed (or "No change").',
    every: '3hours',
    maxRuns: 16,
    days: 2,
    uses: 'Read a web page (only if switched on in the Toolbox).',
  },
];
