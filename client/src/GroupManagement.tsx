import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChevronRight, Pencil, Plus, UsersRound, X } from 'lucide-react';
import './group-management.css';

export type GroupItem = { id: string; name: string };
export type Group = GroupItem & { members: GroupItem[]; offerings: GroupItem[] };

type Props = { groups: Group[]; onBack: () => void; onReload: () => Promise<void> };
type Mutation = (path: string, method: 'POST' | 'PATCH' | 'DELETE', name?: string) => Promise<boolean>;

export default function GroupManagement({ groups, onBack, onReload }: Props) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingGroup, setAddingGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [editingGroup, setEditingGroup] = useState(false);
  const [editGroupName, setEditGroupName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selected = groups.find(group => group.id === selectedId);

  const mutate: Mutation = async (path, method, name) => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(path, {
        method, credentials: 'include',
        ...(name === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || data.error || 'Unable to complete request');
      }
      await onReload();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const addGroup = async (event: FormEvent) => {
    event.preventDefault();
    if (!groupName.trim()) return;
    if (await mutate('/daiko-api/groups', 'POST', groupName)) {
      setGroupName('');
      setAddingGroup(false);
    }
  };
  const saveGroup = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !editGroupName.trim()) return;
    if (await mutate(`/daiko-api/groups/${encodeURIComponent(selected.id)}`, 'PATCH', editGroupName)) setEditingGroup(false);
  };
  const back = () => { setSelectedId(null); setEditingGroup(false); setError(''); };

  return <>
    <button type="button" className="back" onClick={selected ? back : onBack} disabled={busy}><ArrowLeft size={16}/> {t(selected ? 'Manage groups' : 'Settings')}</button>
    <div className="page-heading"><h1>{selected ? selected.name : t('Manage groups')}</h1>{!selected && !addingGroup && <button className="button primary" onClick={() => setAddingGroup(true)} disabled={busy}><Plus size={16}/> {t('Add group')}</button>}</div>
    {error && <div className="alert error" role="alert">{t(error, { defaultValue: error })}<button aria-label={t('Dismiss')} onClick={() => setError('')}><X size={16}/></button></div>}
    {!selected && <>
      {addingGroup && <form className="panel group-create" onSubmit={addGroup}>
        <label>{t('Group name')} <span className="required">*</span><input autoFocus required maxLength={200} value={groupName} onChange={event => setGroupName(event.target.value)} disabled={busy} placeholder={t('Name of the group')}/></label>
        <div className="group-form-actions"><button type="button" className="button secondary" onClick={() => {setAddingGroup(false); setGroupName(''); setError('');}} disabled={busy}>{t('Cancel')}</button><button className="button primary" disabled={busy || !groupName.trim()}>{busy ? t('Adding…') : t('Add group')}</button></div>
      </form>}
      <div className="section-heading"><h2>{t('Groups')}</h2><span className="count">{t('groupCount', { count: groups.length, defaultValue: '{{count}} groups' })}</span></div>
      <div className="group-list">{groups.length ? groups.map(group => <button key={group.id} className="group-card" onClick={() => {setSelectedId(group.id); setError('');}}><span className="group-card-icon"><UsersRound size={19}/></span><strong>{group.name}</strong><ChevronRight size={18}/></button>) : <div className="empty"><div className="empty-icon"><UsersRound size={22}/></div><h3>{t('No groups yet')}</h3><p>{t('Add a group to manage its members and offerings.')}</p></div>}</div>
    </>}
    {selected && <div className="group-details">
      <section className="panel group-panel">
        <div className="group-panel-heading"><h2>{t('Group name')}</h2>{!editingGroup && <button className="button secondary" onClick={() => {setEditGroupName(selected.name); setEditingGroup(true);}} disabled={busy}><Pencil size={14}/> {t('Edit')}</button>}</div>
        {editingGroup ? <form onSubmit={saveGroup}><label className="group-sr-only" htmlFor="edit-group-name">{t('Group name')}</label><input id="edit-group-name" autoFocus required maxLength={200} value={editGroupName} onChange={event => setEditGroupName(event.target.value)} disabled={busy}/><div className="group-form-actions"><button type="button" className="button secondary" onClick={() => setEditingGroup(false)} disabled={busy}>{t('Cancel')}</button><button className="button primary" disabled={busy || !editGroupName.trim()}>{t('Save')}</button></div></form> : <p className="group-current-name">{selected.name}</p>}
      </section>
      <EntityList key={`${selected.id}-members`} title={t('Members')} addLabel={t('Add member')} nameLabel={t('Member name')} empty={t('No members yet')} items={selected.members} basePath={`/daiko-api/groups/${encodeURIComponent(selected.id)}/members`} busy={busy} mutate={mutate}/>
      <EntityList key={`${selected.id}-offerings`} title={t('Daiko offerings')} addLabel={t('Add offering')} nameLabel={t('Offering name')} empty={t('No offerings yet')} items={selected.offerings} basePath={`/daiko-api/groups/${encodeURIComponent(selected.id)}/offerings`} busy={busy} mutate={mutate} removable/>
    </div>}
  </>;
}

type EntityListProps = { title: string; addLabel: string; nameLabel: string; empty: string; items: GroupItem[]; basePath: string; busy: boolean; mutate: Mutation; removable?: boolean };
function EntityList({ title, addLabel, nameLabel, empty, items, basePath, busy, mutate, removable = false }: EntityListProps) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    if (await mutate(basePath, 'POST', name)) { setName(''); setAdding(false); }
  };
  const save = async (event: FormEvent, id: string) => {
    event.preventDefault();
    if (!editName.trim()) return;
    if (await mutate(`${basePath}/${encodeURIComponent(id)}`, 'PATCH', editName)) setEditingId(null);
  };
  const remove = async (id: string) => {
    if (window.confirm(t('Remove this offering? Existing requests will be kept.'))) await mutate(`${basePath}/${encodeURIComponent(id)}`, 'DELETE');
  };
  return <section className="panel group-panel">
    <div className="group-panel-heading"><h2>{title}</h2>{!adding && <button className="button secondary" onClick={() => setAdding(true)} disabled={busy}><Plus size={15}/> {addLabel}</button>}</div>
    {adding && <form className="group-inline-form" onSubmit={add}><label className="group-sr-only" htmlFor={`${basePath}-new`}>{nameLabel}</label><input id={`${basePath}-new`} autoFocus required maxLength={200} value={name} onChange={event => setName(event.target.value)} placeholder={nameLabel} disabled={busy}/><button className="button primary" disabled={busy || !name.trim()}>{t('Add')}</button><button type="button" className="button secondary" onClick={() => {setAdding(false); setName('');}} disabled={busy}>{t('Cancel')}</button></form>}
    {items.length ? <ul className="group-entities">{items.map(item => <li key={item.id}>{editingId === item.id ? <form className="group-inline-form group-edit-form" onSubmit={event => save(event, item.id)}><label className="group-sr-only" htmlFor={`edit-${item.id}`}>{nameLabel}</label><input id={`edit-${item.id}`} autoFocus required maxLength={200} value={editName} onChange={event => setEditName(event.target.value)} disabled={busy}/><button className="button primary" disabled={busy || !editName.trim()}>{t('Save')}</button><button type="button" className="button secondary" onClick={() => setEditingId(null)} disabled={busy}>{t('Cancel')}</button></form> : <><span>{item.name}</span><div className="group-row-actions"><button className="text-button" onClick={() => {setEditingId(item.id); setEditName(item.name);}} disabled={busy} aria-label={t('Edit {{name}}', { name: item.name })}>{t('Edit')}</button>{removable && <button className="text-button group-remove" onClick={() => remove(item.id)} disabled={busy} aria-label={t('Remove {{name}}', { name: item.name })}>{t('Remove')}</button>}</div></>}</li>)}</ul> : <p className="group-empty">{empty}</p>}
  </section>;
}
