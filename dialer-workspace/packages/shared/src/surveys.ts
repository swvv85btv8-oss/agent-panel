import { ResponseType, Survey, VoiceEntry, VoiceSurvey, WebQuestion, WebSurvey } from './types';

export const RECORDINGS = ['', 'TEST', 'Thanks for calling', 'Rate your experience', 'Goodbye'];
export const DTMF_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
export const DESTINATIONS = ['Next Recording', 'Repeat question', 'Hangup', 'Transfer to agent'];

export const RESPONSE_TYPES: ResponseType[] = [
  'Dropdown',
  'Checkboxes (multiple)',
  'Short answer',
  'Date',
  'Date/Time',
];

/** Options are required — and at least two of them — only for the choice types. */
export function hasOptions(type: ResponseType): boolean {
  return type === 'Dropdown' || type === 'Checkboxes (multiple)';
}

export const MIN_OPTIONS = 2;

export function newVoiceEntry(id: string): VoiceEntry {
  return { id, rec: '', dtmf: '1', dest: 'Next Recording' };
}

export function newWebQuestion(id: string): WebQuestion {
  return { id, text: '', rtype: 'Dropdown', options: ['', ''] };
}

export function newVoiceSurvey(id: string, entryId: string, name = ''): VoiceSurvey {
  return {
    id,
    name,
    desc: '',
    type: 'voice',
    digitTimeout: '10',
    entries: [newVoiceEntry(entryId)],
    inv: { rec: '', retries: '1', retryRec: '', dest: 'Repeat question' },
    tmo: { rec: '', retries: '1', retryRec: '', dest: 'Repeat question' },
  };
}

export function newWebSurvey(id: string, questionId: string, name = ''): WebSurvey {
  return { id, name, desc: '', type: 'web', questions: [newWebQuestion(questionId)] };
}

/**
 * Survey type is chosen at creation and is IMMUTABLE — converting a voice survey to a
 * web one (or back) would discard every type-specific setting, so the UI never offers it.
 */
export function canConvertType(): false {
  return false;
}

export function surveyIssues(survey: Survey): string[] {
  const out: string[] = [];
  if (!survey.name.trim()) out.push('A name');

  if (survey.type === 'voice') {
    if (!survey.entries.length) out.push('At least one recording entry');
    survey.entries.forEach((e, i) => {
      if (!e.rec) out.push(`A recording for entry ${i + 1}`);
    });
    if (!survey.inv.rec) out.push('An invalid-input recording');
    if (!survey.tmo.rec) out.push('A timeout recording');
  } else {
    if (!survey.questions.length) out.push('At least one question');
    survey.questions.forEach((q, i) => {
      if (!q.text.trim()) out.push(`Question ${i + 1} needs text`);
      if (hasOptions(q.rtype) && q.options.filter((o) => o.trim()).length < MIN_OPTIONS) {
        out.push(`Question ${i + 1} needs at least ${MIN_OPTIONS} options`);
      }
    });
  }
  return out;
}

export function surveyEntryCount(survey: Survey): number {
  return survey.type === 'voice' ? survey.entries.length : survey.questions.length;
}
