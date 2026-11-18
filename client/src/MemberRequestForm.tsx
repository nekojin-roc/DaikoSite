import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, CalendarDays, Clock3, Plus, Trash2 } from 'lucide-react';
import './MemberRequestForm.css';

type RequestEvent = { id: string; name: string; groupName: string; groupId: string | null; startsAt: string; imageUrl: string | null };
type Group = { id: string; name: string; members: { id: string; name: string }[]; offerings: { id: string; name: string }[] };
export type MemberRequestPayload = { memberId: string; offeringId: string; message: string; amount?: number | null; image?: { mimeType: string; data: string } } | { type: 'GOODS'; message: string };

type Props = { event: RequestEvent; group: Group | undefined; onBack: () => void; onSubmit: (requests: MemberRequestPayload[]) => Promise<void>; busy: boolean };
type Draft = {
  id: number;
  kind: 'MEMBER' | 'GOODS';
  memberId: string;
  offeringId: string;
  message: string;
  amount: string;
  image: File | null;
  imageError: string;
};
type DraftChanges = Partial<Omit<Draft, 'id'>>;
const MAX_CARDS = 10;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function newDraft(id: number): Draft {
  return { id, kind: 'MEMBER', memberId: '', offeringId: '', message: '', amount: '1', image: null, imageError: '' };
}

function isComplete(draft: Draft, group: Group | undefined) {
  if (!draft.message.trim()) return false;
  if (draft.kind === 'GOODS') return true;
  return !draft.imageError &&
    group?.members.some(member => member.id === draft.memberId) &&
    group.offerings.some(offering => offering.id === draft.offeringId) &&
    /^\d+$/.test(draft.amount) && Number(draft.amount) >= 1 && Number(draft.amount) <= 1000;
}

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const fail = () => reject(new Error('Could not read the image. Please try again.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string' || !reader.result.includes(',')) return fail();
      resolve(reader.result.slice(reader.result.indexOf(',') + 1));
    };
    reader.onerror = reader.onabort = fail;
    reader.readAsDataURL(file);
  });
}

type CardProps = {
  draft: Draft;
  number: number;
  group?: Group;
  disabled: boolean;
  onChange: (patch: DraftChanges) => void;
  onRemove?: () => void;
};
function RequestDraftCard({ draft, number, group, disabled, onChange, onRemove }: CardProps) {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [preview, setPreview] = useState('');
  const { id, kind, memberId, offeringId, message, amount, image, imageError } = draft;
  const members = group?.members ?? [];
  const offerings = group?.offerings ?? [];

  useEffect(() => {
    if (id > 1) heading.current?.focus();
  }, [id]);
  useEffect(() => {
    if (!image) { setPreview(''); return; }
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  function selectImage(file?: File) {
    let error = '';
    if (file && !IMAGE_TYPES.has(file.type)) error = 'Please choose a JPEG, PNG, WebP, or GIF image.';
    else if (file && file.size > MAX_IMAGE_BYTES) error = 'The image must be 5 MiB or smaller.';
    onChange({ image: error ? null : file ?? null, imageError: error });
  }
  function removeImage() {
    if (fileInput.current) fileInput.current.value = '';
    onChange({ image: null, imageError: '' });
  }
  const unavailable = !group ? 'This event does not have a configured group. Please contact an administrator.'
    : !members.length && !offerings.length ? 'This group has no members or daiko types yet. Please contact an administrator.'
    : !members.length ? 'This group has no members yet. Please contact an administrator.'
    : !offerings.length ? 'This group has no daiko types yet. Please contact an administrator.' : '';
  const titleId = `request-card-${id}`;
  const helpId = `request-image-help-${id}`;

  return <section className="panel request-form" aria-labelledby={titleId}>
    <div className="panel-title request-card-heading">
      <h2 id={titleId} ref={heading} tabIndex={-1}>{t('Request {{number}}', {number})}</h2>
      {onRemove && <button type="button" className="text-button" aria-label={t('Remove request {{number}}', {number})} onClick={onRemove} disabled={disabled}>
        <Trash2 size={15} aria-hidden="true"/> {t('Remove')}
      </button>}
    </div>
    <fieldset className="member-request-kind" disabled={disabled}>
      <legend>{t('Request type')}</legend>
      <div className="type-picker">
        <button type="button" className={`type-option ${kind === 'MEMBER' ? 'selected' : ''}`} aria-pressed={kind === 'MEMBER'} onClick={() => onChange({kind: 'MEMBER'})}><strong>{t('Member request')}</strong></button>
        <button type="button" className={`type-option ${kind === 'GOODS' ? 'selected' : ''}`} aria-pressed={kind === 'GOODS'} onClick={() => onChange({kind: 'GOODS'})}><strong>{t('Goods')}</strong></button>
      </div>
    </fieldset>
    {kind === 'MEMBER' && <>
      {unavailable && <div className="member-request-notice" role="status">{t(unavailable)}</div>}
      <label>{t('Member')} <span className="required">*</span>
        <select required value={memberId} onChange={e => onChange({memberId: e.target.value})} disabled={!members.length || disabled}>
          <option value="">{t('Select a member')}</option>
          {members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
        </select>
      </label>
      <label>{t('Daiko type')} <span className="required">*</span>
        <select required value={offeringId} onChange={e => onChange({offeringId: e.target.value})} disabled={!offerings.length || disabled}>
          <option value="">{t('Select a daiko type')}</option>
          {offerings.map(offering => <option key={offering.id} value={offering.id}>{offering.name}</option>)}
        </select>
      </label>
      <label>{t('Quantity')} <span className="required">*</span>
        <input required type="number" min="1" max="1000" step="1" value={amount} onChange={e => onChange({amount: e.target.value})} disabled={disabled}/>
      </label>
    </>}
    <label>{t(kind === 'GOODS' ? 'Request details' : 'Message')} <span className="required">*</span>
      <textarea required maxLength={5000} rows={4} value={message} onChange={e => onChange({message: e.target.value})} placeholder={t(kind === 'GOODS' ? 'Tell us what goods you would like…' : 'Write the message you’d like to send…')} disabled={disabled}/>
    </label>
    {kind === 'MEMBER' && <>
      <label>{t('Image (optional)')}
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={e => selectImage(e.target.files?.[0])} disabled={disabled} aria-describedby={helpId}/>
        <small id={helpId}>{t('JPEG, PNG, WebP, or GIF, up to 5 MiB.')}</small>
      </label>
      {imageError && <div className="alert error" role="alert">{t(imageError)}</div>}
      {image && preview && <div className="event-image-preview member-request-image">
        <img src={preview} alt={t('Selected image preview')}/>
        <div className="preview-caption"><span>{image.name}</span><button className="text-button" type="button" onClick={removeImage} disabled={disabled}>{t('Remove image')}</button></div>
      </div>}
      {imageError && !image && <button type="button" className="text-button member-request-remove" onClick={removeImage} disabled={disabled}>{t('Remove image')}</button>}
    </>}
  </section>;
}

export default function MemberRequestForm({ event, group, onBack, onSubmit, busy }: Props) {
  const { t, i18n } = useTranslation();
  const [drafts, setDrafts] = useState(() => [newDraft(1)]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const nextId = useRef(2);
  const submitting = useRef(false);
  const activeGroup = event.groupId === group?.id ? group : undefined;
  const disabled = busy || pending;
  const imageBytes = drafts.reduce((total, draft) => total + (draft.kind === 'MEMBER' ? draft.image?.size ?? 0 : 0), 0);
  const smallEnough = imageBytes <= MAX_IMAGE_BYTES;
  const ready = smallEnough && drafts.every(draft => isComplete(draft, activeGroup));

  function editDraft(id: number, changes: DraftChanges) {
    setDrafts(current => current.map(draft => draft.id === id ? { ...draft, ...changes } : draft));
    setError('');
  }
  function addDraft() {
    const draft = newDraft(nextId.current++);
    setDrafts(current => current.length < MAX_CARDS ? [...current, draft] : current);
    setError('');
  }
  function removeDraft(id: number) {
    setDrafts(current => current.filter(draft => draft.id !== id));
    setError('');
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting.current || disabled || !ready) return;
    submitting.current = true;
    setPending(true);
    setError('');
    try {
      const requests: MemberRequestPayload[] = [];
      for (const draft of drafts) {
        const message = draft.message.trim();
        if (draft.kind === 'GOODS') {
          requests.push({ type: 'GOODS', message });
          continue;
        }
        const request: MemberRequestPayload = { memberId: draft.memberId, offeringId: draft.offeringId, amount: Number(draft.amount), message };
        if (draft.image) {
          try {
            request.image = { mimeType: draft.image.type, data: await readImage(draft.image) };
          } catch {
            editDraft(draft.id, {imageError: 'Could not read the image. Please try again.'});
            return;
          }
        }
        requests.push(request);
      }
      await onSubmit(requests);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong. Please try again.');
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  const when = new Date(event.startsAt);
  return <>
    <button className="back" onClick={onBack} disabled={disabled}><ArrowLeft size={16}/> {t('Back to events')}</button>
    <div className="page-heading"><h1>{t('Tell us what you need')}</h1></div>
    <div className="form-layout">
      <form className="request-draft-queue" onSubmit={submit}>
        {drafts.map((draft, index) => <RequestDraftCard key={draft.id} draft={draft} number={index + 1} group={activeGroup} disabled={disabled}
          onChange={changes => editDraft(draft.id, changes)} onRemove={drafts.length > 1 ? () => removeDraft(draft.id) : undefined}/>)}
        {drafts.length === MAX_CARDS && <p className="field-help" role="status">{t('You can add up to {{count}} requests at a time.', {count: MAX_CARDS})}</p>}
        {!smallEnough && <div className="alert error" role="alert">{t('Images in one submission must total 5 MiB or less.')}</div>}
        {error && <div className="alert error" role="alert">{t(error)}</div>}
        <div className="request-queue-actions">
          <button type="button" className="button secondary" onClick={addDraft} disabled={disabled || drafts.length >= MAX_CARDS}><Plus size={16}/> {t('Add another request')}</button>
          <button type="button" className="button secondary" onClick={onBack} disabled={disabled}>{t('Cancel')}</button>
          <button className="button primary" disabled={!ready || disabled}>{disabled ? t('Submitting…') : t('submitRequestCount', {count: drafts.length})} <ArrowRight size={16}/></button>
        </div>
      </form>
      <aside className="summary-card"><div className="summary-label">{t('SELECTED EVENT')}</div><div className="summary-icon"><CalendarDays size={20}/></div><h3>{event.name}</h3><p>{event.groupName}</p><div className="summary-date"><CalendarDays size={15}/>{when.toLocaleDateString(i18n.resolvedLanguage, {weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Tokyo'})}<br/><Clock3 size={15}/>{when.toLocaleTimeString(i18n.resolvedLanguage, {hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Tokyo'})} JST</div></aside>
    </div>
  </>;
}
