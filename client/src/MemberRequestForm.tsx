import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, CalendarDays, Clock3 } from 'lucide-react';
import './MemberRequestForm.css';

type RequestEvent = { id: string; name: string; groupName: string; groupId: string | null; startsAt: string; imageUrl: string | null };
type Group = { id: string; name: string; members: { id: string; name: string }[]; offerings: { id: string; name: string }[] };
export type MemberRequestPayload = { memberId: string; offeringId: string; message: string; amount?: number | null; image?: { mimeType: string; data: string } } | { type: 'GOODS'; message: string };

type Props = { event: RequestEvent; group: Group | undefined; onBack: () => void; onSubmit: (payload: MemberRequestPayload) => void; busy: boolean };
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export default function MemberRequestForm({ event, group, onBack, onSubmit, busy }: Props) {
  const { t, i18n } = useTranslation();
  const [kind, setKind] = useState<'MEMBER' | 'GOODS'>('MEMBER');
  const [memberId, setMemberId] = useState('');
  const [offeringId, setOfferingId] = useState('');
  const [message, setMessage] = useState('');
  const [amount, setAmount] = useState('1');
  const [image, setImage] = useState<{ mimeType: string; data: string; file: File } | null>(null);
  const [preview, setPreview] = useState('');
  const [imageError, setImageError] = useState('');
  const [reading, setReading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const readSequence = useRef(0);
  const currentGroup = group && event.groupId === group.id ? group : null;
  const members = currentGroup?.members ?? [];
  const offerings = currentGroup?.offerings ?? [];
  const validMember = members.some(member => member.id === memberId);
  const validOffering = offerings.some(offering => offering.id === offeringId);
  const validAmount = /^\d+$/.test(amount) && Number(amount) >= 1 && Number(amount) <= 1000;
  const canSubmit = !!message.trim() && !busy && (kind === 'GOODS' || (validMember && validOffering && validAmount && !reading && !imageError));

  useEffect(() => {
    if (!image) { setPreview(''); return; }
    const url = URL.createObjectURL(image.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);
  useEffect(() => () => { readSequence.current += 1; }, []);

  const removeImage = () => {
    readSequence.current += 1;
    setImage(null);
    setImageError('');
    setReading(false);
    if (fileInput.current) fileInput.current.value = '';
  };
  const selectImage = (file?: File) => {
    const sequence = ++readSequence.current;
    setImage(null);
    setImageError('');
    setReading(false);
    if (!file) return;
    if (!IMAGE_TYPES.has(file.type)) { setImageError('Please choose a JPEG, PNG, WebP, or GIF image.'); return; }
    if (file.size > MAX_IMAGE_SIZE) { setImageError('The image must be 5 MiB or smaller.'); return; }
    setReading(true);
    const reader = new FileReader();
    reader.onload = () => {
      if (sequence !== readSequence.current) return;
      const result = reader.result;
      if (typeof result !== 'string' || !result.includes(',')) {
        setImageError('Could not read the image. Please try again.');
      } else {
        setImage({ mimeType: file.type, data: result.slice(result.indexOf(',') + 1), file });
      }
      setReading(false);
    };
    reader.onerror = reader.onabort = () => {
      if (sequence !== readSequence.current) return;
      setImageError('Could not read the image. Please try again.');
      setReading(false);
    };
    try { reader.readAsDataURL(file); }
    catch {
      if (sequence === readSequence.current) {
        setImageError('Could not read the image. Please try again.');
        setReading(false);
      }
    }
  };
  const unavailable = !currentGroup ? t('This event does not have a configured group. Please contact an administrator.')
    : !members.length && !offerings.length ? t('This group has no members or daiko types yet. Please contact an administrator.')
    : !members.length ? t('This group has no members yet. Please contact an administrator.')
    : !offerings.length ? t('This group has no daiko types yet. Please contact an administrator.') : '';
  const when = new Date(event.startsAt);
  return <>
    <button className="back" onClick={onBack} disabled={busy}><ArrowLeft size={16}/> {t('Back to events')}</button>
    <div className="page-heading"><div><h1>{t('Tell us what you need')}</h1></div></div>
    <div className="form-layout">
      <form className="panel request-form" onSubmit={e => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit(kind === 'GOODS' ? {type: 'GOODS', message: message.trim()} : { memberId, offeringId, message: message.trim(), amount: Number(amount), ...(image ? {image: {mimeType: image.mimeType, data: image.data}} : {}) });
      }}>
        <div className="panel-title"><h2>{t('Request details')}</h2></div>
        <fieldset className="member-request-kind">
          <legend>{t('Request type')}</legend>
          <div className="type-picker">
            <button type="button" className={`type-option ${kind === 'MEMBER' ? 'selected' : ''}`} aria-pressed={kind === 'MEMBER'} disabled={busy} onClick={() => setKind('MEMBER')}><strong>{t('Member request')}</strong></button>
            <button type="button" className={`type-option ${kind === 'GOODS' ? 'selected' : ''}`} aria-pressed={kind === 'GOODS'} disabled={busy} onClick={() => setKind('GOODS')}><strong>{t('Goods')}</strong></button>
          </div>
        </fieldset>
        {kind === 'MEMBER' && <>
        {unavailable && <div className="member-request-notice" role="status">{unavailable}</div>}
        <label>{t('Member')} <span className="required">*</span>
          <select required value={validMember ? memberId : ''} onChange={e => setMemberId(e.target.value)} disabled={!members.length || busy}>
            <option value="">{t('Select a member')}</option>
            {members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select>
        </label>
        <label>{t('Daiko type')} <span className="required">*</span>
          <select required value={validOffering ? offeringId : ''} onChange={e => setOfferingId(e.target.value)} disabled={!offerings.length || busy}>
            <option value="">{t('Select a daiko type')}</option>
            {offerings.map(offering => <option key={offering.id} value={offering.id}>{offering.name}</option>)}
          </select>
        </label>
        <label>{t('Quantity')} <span className="required">*</span>
          <input type="number" min="1" max="1000" step="1" required value={amount} onChange={e => setAmount(e.target.value)} disabled={busy}/>
        </label>
        </>}
        <label>{t(kind === 'GOODS' ? 'Request details' : 'Message')} <span className="required">*</span>
          <textarea required maxLength={5000} rows={6} value={message} onChange={e => setMessage(e.target.value)} placeholder={t(kind === 'GOODS' ? 'Tell us what goods you would like…' : 'Write the message you’d like to send…')} disabled={busy}/>
        </label>
        {kind === 'MEMBER' && <>
        <label>{t('Image (optional)')}
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={e => selectImage(e.target.files?.[0])} disabled={busy} aria-describedby="request-image-help"/>
          <small id="request-image-help">{t('JPEG, PNG, WebP, or GIF, up to 5 MiB.')}</small>
        </label>
        {reading && <p className="field-help" role="status">{t('Reading image…')}</p>}
        {imageError && <div className="alert error" role="alert">{t(imageError)}</div>}
        {preview && <div className="event-image-preview member-request-image"><img src={preview} alt={t('Selected image preview')}/><div className="preview-caption"><span>{image?.file.name}</span><button className="text-button" type="button" onClick={removeImage} disabled={busy}>{t('Remove image')}</button></div></div>}
        {(reading || imageError) && <button className="text-button member-request-remove" type="button" onClick={removeImage} disabled={busy}>{t('Remove image')}</button>}
        </>}
        <div className="form-actions"><button type="button" className="button secondary" onClick={onBack} disabled={busy}>{t('Cancel')}</button><button className="button primary" disabled={!canSubmit}>{busy ? t('Submitting…') : t('Submit request')} <ArrowRight size={16}/></button></div>
      </form>
      <aside className="summary-card"><div className="summary-label">{t('SELECTED EVENT')}</div><div className="summary-icon"><CalendarDays size={20}/></div><h3>{event.name}</h3><p>{event.groupName}</p><div className="summary-date"><CalendarDays size={15}/>{when.toLocaleDateString(i18n.resolvedLanguage, {weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'})}<br/><Clock3 size={15}/>{when.toLocaleTimeString(i18n.resolvedLanguage, {hour: 'numeric', minute: '2-digit'})}</div></aside>
    </div>
  </>;
}
