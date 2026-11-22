import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Group } from './GroupManagement';
import { REQUEST_IMAGE_ACCEPT, readRequestImage, requestImageError, type RequestImage } from './request-image';

export type RequestUpdate = {
  message: string;
  amount?: number | null;
  memberId?: string;
  offeringId?: string;
  image?: RequestImage | null;
};

type Props = {
  request: {
    type: string;
    message: string;
    amount: number | null;
    memberName?: string | null;
    offeringName?: string | null;
    imageUrl?: string | null;
  };
  group?: Group;
  onSave: (update: RequestUpdate) => Promise<void>;
  onCancel: () => void;
};

export default function RequestEditForm({request, group, onSave, onCancel}: Props) {
  const {t} = useTranslation();
  const [message, setMessage] = useState(request.message);
  const [amount, setAmount] = useState(request.amount?.toString() ?? '');
  const [memberId, setMemberId] = useState('');
  const [offeringId, setOfferingId] = useState('');
  const [image, setImage] = useState<File | null>();
  const [preview, setPreview] = useState('');
  const [imageError, setImageError] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const imageHelpId = useId();
  const custom = request.type === 'CUSTOM';
  const cheki = request.type === 'CHEKI';
  const hasAmount = custom || cheki;
  const quantity = amount ? Number(amount) : null;
  const validQuantity = quantity === null ? !cheki : Number.isInteger(quantity) && quantity >= 1 && quantity <= 1000;
  const canSave = !!message.trim() && (!hasAmount || validQuantity) && !imageError && !pending;
  const imageSrc = image === undefined ? request.imageUrl : preview;

  useEffect(() => {
    if (!image) { setPreview(''); return; }
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  function resetImage(value: null | undefined) {
    if (fileInput.current) fileInput.current.value = '';
    setImage(value);
    setImageError('');
  }

  function selectImage(file?: File) {
    if (!file) return;
    const issue = requestImageError(file);
    setImageError(issue);
    if (!issue) setImage(file);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave || submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError('');
    try {
      const update: RequestUpdate = { message: message.trim() };
      if (cheki || (custom && quantity !== request.amount)) update.amount = quantity;
      if (memberId) update.memberId = memberId;
      if (offeringId) update.offeringId = offeringId;
      if (image !== undefined) update.image = image ? await readRequestImage(image) : null;
      await onSave(update);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong. Please try again.');
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return <form className="request-form request-editor" aria-label={t('Edit request')} onSubmit={save}>
    {custom && !!group?.members.length && <label>{t('Member')}
      <select value={memberId} onChange={event => setMemberId(event.target.value)} disabled={pending}>
        <option value="">{request.memberName ? t('Keep {{name}}', {name: request.memberName}) : t('Keep current selection')}</option>
        {group.members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
      </select>
    </label>}
    {custom && !!group?.offerings.length && <label>{t('Daiko type')}
      <select value={offeringId} onChange={event => setOfferingId(event.target.value)} disabled={pending}>
        <option value="">{request.offeringName ? t('Keep {{name}}', {name: request.offeringName}) : t('Keep current selection')}</option>
        {group.offerings.map(offering => <option key={offering.id} value={offering.id}>{offering.name}</option>)}
      </select>
    </label>}
    {hasAmount && <label>{t('Quantity')}
      <input type="number" min="1" max="1000" step="1" value={amount} required={cheki} onChange={event => setAmount(event.target.value)} disabled={pending}/>
    </label>}
    <label>{t(request.type === 'GOODS' ? 'Request details' : 'Message')}
      <textarea required maxLength={5000} rows={4} value={message} onChange={event => setMessage(event.target.value)} disabled={pending} autoFocus/>
    </label>
    {custom && <>
      <label>{t('Image (optional)')}
        <input type="file" ref={fileInput} accept={REQUEST_IMAGE_ACCEPT} onChange={event => selectImage(event.target.files?.[0])} disabled={pending} aria-describedby={imageHelpId}/>
        <small id={imageHelpId}>{t('JPEG, PNG, WebP, or GIF, up to 5 MiB.')}</small>
      </label>
      {imageSrc && <div className="event-image-preview member-request-image">
        <img src={imageSrc} alt={t(image ? 'Selected image preview' : 'Attached image')}/>
        <div className="preview-caption">
          <span>{image?.name ?? t('Attached image')}</span>
          <button type="button" className="text-button" onClick={() => resetImage(request.imageUrl ? null : undefined)} disabled={pending}>{t('Remove image')}</button>
        </div>
      </div>}
      {(image !== undefined || imageError) && <button type="button" className="text-button member-request-remove" onClick={() => resetImage(undefined)} disabled={pending}>{t('Undo image change')}</button>}
    </>}
    {imageError && <div className="alert error" role="alert">{t(imageError)}</div>}
    {error && <div className="alert error" role="alert">{t(error, {defaultValue: error})}</div>}
    <div className="form-actions">
      <button type="button" className="button secondary" onClick={onCancel} disabled={pending}>{t('Cancel')}</button>
      <button type="submit" className="button primary" disabled={!canSave}>{pending ? t('Saving…') : t('Save')}</button>
    </div>
  </form>;
}
