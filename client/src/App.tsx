import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n, { changeLanguage, supportedLanguage, type Language } from './i18n/config';
import { appearances, useAppearance } from './Appearance';
import GroupManagement, { type Group } from './GroupManagement';
import MemberRequestForm from './MemberRequestForm';
import { version } from '../package.json';
import { ArrowLeft, ArrowRight, CalendarDays, Check, ChevronRight, ClipboardList, Clock3, History, Image as ImageIcon, Layers3, LogOut, Plus, Settings as SettingsIcon, Sparkles, Trash2, UserRound, UsersRound, X } from 'lucide-react';

const daikoLogo = new URL('./assets/daiko-logo.jpg', import.meta.url).href;

type User = { id: string; name: string; email: string; role: string };
type Event = { id: string; name: string; groupName: string; groupId: string | null; startsAt: string; imageUrl: string | null; requestCount: number };
type RequestItem = { id: string; type: string; finishedAt?: string | null; memberName?: string | null; offeringName?: string | null; imageUrl?: string | null; amount: number | null; message: string; createdAt: string; user?: {name: string; email: string}; event?: Pick<Event, 'id' | 'name' | 'groupName' | 'startsAt'> };
type View = 'events' | 'requests' | 'admin' | 'past' | 'groups' | 'settings';

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: 'include', ...options, headers: { ...(options.body ? {'Content-Type': 'application/json'} : {}), ...options.headers } });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || data.error || `Something went wrong (${response.status}).`);
  }
  return response.status === 204 ? undefined as T : response.json();
}
const post = <T,>(path: string, body: object = {}) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });
const date = (value: string, options: Intl.DateTimeFormatOptions) => new Date(value).toLocaleDateString(i18n.resolvedLanguage, options);
const eventDate = (value: string) => date(value, {weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'});
const time = (value: string) => new Date(value).toLocaleString(i18n.resolvedLanguage, {hour: 'numeric', minute: '2-digit'});
const submitted = (value: string) => new Date(value).toLocaleString(i18n.resolvedLanguage, {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'});
const errorText = (e: unknown) => e instanceof Error ? e.message : 'Something went wrong. Please try again.';
const startOfToday = () => new Date().setHours(0, 0, 0, 0);

function App() {
  const { t } = useTranslation();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<Event[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [myRequests, setMyRequests] = useState<RequestItem[]>([]);
  const [view, setView] = useState<View>('events');
  const [selected, setSelected] = useState<Event | null>(null);
  const [queueEvent, setQueueEvent] = useState<Event | null>(null);
  const [queue, setQueue] = useState<RequestItem[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [finishingId, setFinishingId] = useState<string | null>(null);
  const [today, setToday] = useState(startOfToday);
  const admin = user?.role?.toUpperCase() === 'ADMIN';
  const upcomingEvents = events.filter(event => new Date(event.startsAt).getTime() >= today);
  const pastEvents = events.filter(event => new Date(event.startsAt).getTime() < today).reverse();
  const eventListView = (view === 'events' && !selected) || (admin && ((view === 'admin' && !showCreate && !queueEvent) || (view === 'past' && !queueEvent)));

  const loadEvents = async () => { const result = await api<{events: Event[]}>('/daiko-api/events'); setEvents([...result.events].sort((a,b) => +new Date(a.startsAt) - +new Date(b.startsAt))); };
  const loadGroups = async () => { const result = await api<{groups: Group[]}>('/daiko-api/groups'); setGroups(result.groups); };
  const loadMyRequests = async () => { const result = await api<{requests: RequestItem[]}>('/daiko-api/my-requests'); setMyRequests(result.requests); };
  const initialize = async () => { const result = await api<{user: User | null}>('/daiko-api/session'); setUser(result.user); if (result.user) { const isAdmin = result.user.role?.toUpperCase() === 'ADMIN'; setView(isAdmin ? 'admin' : 'events'); await Promise.all([loadEvents(), loadGroups(), ...(isAdmin ? [] : [loadMyRequests()])]); } };
  useEffect(() => { initialize().catch(e => setError(errorText(e))).finally(() => setLoading(false)); }, []);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refreshDay = () => {
      clearTimeout(timer);
      setToday(startOfToday());
      const nextDay = new Date();
      nextDay.setHours(24, 0, 0, 0);
      timer = setTimeout(refreshDay, nextDay.getTime() - Date.now() + 50);
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') refreshDay(); };
    refreshDay();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);
  const signIn = async (email: string, password: string) => { setBusy(true); setError(''); try { await post('/api/auth/sign-in/email', {email, password}); await initialize(); } catch(e) { setError(errorText(e)); } finally {setBusy(false);} };
  const signOut = async () => { setBusy(true); try { await post('/api/auth/sign-out'); setUser(null); setView('events'); setSelected(null); setQueueEvent(null); setQueue([]); setEvents([]); setGroups([]); setMyRequests([]); setShowCreate(false); setNotice(''); } catch(e) {setError(errorText(e));} finally {setBusy(false);} };
  const navigate = (next: View) => {setView(next); setSelected(null); setQueueEvent(null); setShowCreate(false); setError(''); setNotice('');};
  const selectQueue = async (event: Event) => {setQueueEvent(event); setQueue([]); setError(''); setBusy(true); try {const result = await api<{requests: RequestItem[]}>(`/daiko-api/events/${event.id}/requests`); setQueue(result.requests);} catch(e){setError(errorText(e));} finally {setBusy(false);} };
  const finishRequest = async (id: string) => {
    if (finishingId) return;
    setFinishingId(id);
    setError('');
    try {
      await post(`/daiko-api/requests/${encodeURIComponent(id)}/finish`);
      setQueue(current => current.filter(item => item.id !== id));
      if (queueEvent) setEvents(current => current.map(item => item.id === queueEvent.id ? {...item, requestCount: Math.max(0, item.requestCount - 1)} : item));
      setNotice('Request finished.');
    } catch(e) { setError(errorText(e)); } finally { setFinishingId(null); }
  };
  const deleteEvent = async (event: Event) => {
    if (!window.confirm(t('Delete {{name}}? Requests shown: {{shownCount}}. All associated requests will also be permanently deleted. This cannot be undone.', {name: event.name, shownCount: queue.length}))) return;
    setBusy(true);
    setError('');
    try {
      await api<void>(`/daiko-api/events/${encodeURIComponent(event.id)}`, {method: 'DELETE'});
      setEvents(current => current.filter(item => item.id !== event.id));
      setQueueEvent(null);
      setQueue([]);
      setNotice('Event deleted successfully.');
    } catch(e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  if (loading) return <div className="loading"><span className="spinner"/> {t("Loading Daiko…")}</div>;
  if (!user) return <Login onSubmit={signIn} busy={busy} error={error}/>;
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><img className="brand-mark" src={daikoLogo} alt=""/><span>Daiko</span></div>
      <div className="nav-label">{admin ? t('MANAGE') : t('YOUR SPACE')}</div>
      <nav className="navigation" aria-label={t("Main navigation")}>
        {admin ? <><button className={view === 'admin' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('admin')}><Layers3 size={17}/> {t("Event management")}</button><button className={view === 'past' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('past')}><History size={17}/> {t("Past events")}</button><button className={view === 'groups' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('groups')}><UsersRound size={17}/> {t('Manage groups')}</button></> : <><button className={view === 'events' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('events')}><CalendarDays size={17}/> {t("Events")}</button><button className={view === 'requests' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('requests')}><ClipboardList size={17}/> {t("My requests")}</button></>}
        <button className={view === 'settings' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('settings')}><SettingsIcon size={17}/> {t('Settings')}</button>
      </nav>
      <div className="sidebar-bottom"><div className="profile"><span className="avatar">{(user.name || user.email).slice(0,1).toUpperCase()}</span><span className="profile-text"><strong>{user.name}</strong><small>{user.email}</small></span></div><button className="signout" onClick={signOut} disabled={busy}><LogOut size={16}/> {t("Sign out")}</button></div>
    </aside>
    <div className={eventListView ? "main-wrap event-list-layout" : "main-wrap"}>
      <header className="mobile-header"><div className="brand"><img className="brand-mark" src={daikoLogo} alt=""/>Daiko</div><button className="icon-button" aria-label={t("Sign out")} title={t("Sign out")} onClick={signOut}><LogOut size={18}/></button></header>
      <div className="mobile-nav">{admin ? <><button className={view === 'admin' ? 'active' : ''} onClick={() => navigate('admin')}>{t("Manage")}</button><button className={view === 'past' ? 'active' : ''} onClick={() => navigate('past')}>{t("Past events")}</button><button className={view === 'groups' ? 'active' : ''} onClick={() => navigate('groups')}>{t('Groups')}</button></> : <><button className={view === 'events' ? 'active' : ''} onClick={() => navigate('events')}>{t("Events")}</button><button className={view === 'requests' ? 'active' : ''} onClick={() => navigate('requests')}>{t("My requests")}</button></>}<button className={view === 'settings' ? 'active' : ''} onClick={() => navigate('settings')}>{t('Settings')}</button></div>
      <main className="content">
        {error && <div className="alert error" role="alert">{t(error, {defaultValue: error})}<button aria-label={t("Dismiss")} onClick={() => setError('')}><X size={16}/></button></div>}
        {notice && <div className="alert success" role="status"><Check size={17}/>{t(notice, {defaultValue: notice})}<button aria-label={t("Dismiss")} onClick={() => setNotice('')}><X size={16}/></button></div>}
        {view === 'events' && !selected && <><div className="page-heading"><div><h1>{t("Find your next event")}</h1></div></div><div className="section-heading"><div><h2>{t("Events")}</h2></div><span className="count">{t('eventCount', {count: events.length})}</span></div><div className="event-list" role="region" aria-label={t("Events")} tabIndex={0}>{events.length ? events.map(event => <EventCard key={event.id} event={event} onClick={() => {setError(''); setNotice(''); setSelected(event);}}/>) : <Empty icon={<CalendarDays size={22}/>} title={t("No events yet")} text={t("Events will appear here once they’ve been added.")}/>}</div><div className="footnote"><Sparkles size={15}/> {t("A little help getting closer to your favorite moments.")}</div></>}
        {view === 'events' && selected && <MemberRequestForm key={selected.id} event={selected} group={groups.find(group => group.id === selected.groupId)} busy={busy} onBack={() => setSelected(null)} onSubmit={async payload => {setBusy(true); setError(''); try {await post(`/daiko-api/events/${selected.id}/requests`, payload); await Promise.all([loadEvents(), loadMyRequests()]); setSelected(null); setNotice('Your request has been submitted. You can find it in My requests.');} catch(e) {setError(errorText(e));} finally {setBusy(false);}}}/>}
        {view === 'requests' && <><div className="page-heading"><div><h1>{t("My requests")}</h1></div><button className="button primary" onClick={() => navigate('events')}><Plus size={16}/> {t("New request")}</button></div><div className="section-heading"><div><h2>{t("Request history")}</h2></div><span className="count">{t('totalCount', {count: myRequests.length})}</span></div><div className="request-list">{myRequests.length ? myRequests.map(request => <RequestCard key={request.id} request={request}/>) : <Empty icon={<ClipboardList size={22}/>} title={t("Nothing here yet")} text={t("Once you submit a request, you’ll see it here.")}/>}</div></>}
        {admin && view === 'admin' && !showCreate && !queueEvent && <><div className="page-heading"><div><h1>{t("Event management")}</h1></div><button className="button primary" onClick={() => setShowCreate(true)}><Plus size={16}/> {t("Add event")}</button></div><div className="section-heading"><div><h2>{t("Upcoming events")}</h2></div><span className="count">{t('eventCount', {count: upcomingEvents.length})}</span></div><div className="event-list" role="region" aria-label={t("Events")} tabIndex={0}>{upcomingEvents.length ? upcomingEvents.map(event => <EventCard key={event.id} event={event} admin onClick={() => selectQueue(event)}/>) : <Empty icon={<CalendarDays size={22}/>} title={t("No upcoming events")} text={t("Add an event to start receiving requests.")}/>}</div></>}
        {admin && view === 'past' && !queueEvent && <><div className="page-heading"><div><h1>{t("Past events")}</h1></div></div><div className="section-heading"><div><h2>{t("Event history")}</h2></div><span className="count">{t('eventCount', {count: pastEvents.length})}</span></div><div className="event-list" role="region" aria-label={t("Events")} tabIndex={0}>{pastEvents.length ? pastEvents.map(event => <EventCard key={event.id} event={event} admin onClick={() => selectQueue(event)}/>) : <Empty icon={<History size={22}/>} title={t("No past events")} text={t("Past events will appear here.")}/>}</div></>}
        {view === 'admin' && showCreate && <CreateEvent groups={groups} busy={busy} onBack={() => setShowCreate(false)} onSubmit={async values => {setBusy(true); setError(''); try {await post('/daiko-api/events', values); await loadEvents(); setShowCreate(false); setNotice('Event added successfully.');} catch(e) {setError(errorText(e));} finally {setBusy(false);}}}/>}
        {admin && (view === 'admin' || view === 'past') && queueEvent && <><button className="back" onClick={() => setQueueEvent(null)}><ArrowLeft size={16}/> {view === 'past' ? t('Past events') : t('Upcoming events')}</button><div className="page-heading"><div><h1>{queueEvent.name}</h1></div><div className="queue-actions"><span className="count">{t('requestCount', {count: queue.length})}</span><button type="button" className="button danger" onClick={() => deleteEvent(queueEvent)} disabled={busy || !!finishingId}><Trash2 size={16}/> {t('Delete event')}</button></div></div><div className="section-heading"><div><h2>{t("Request queue")}</h2></div></div>{busy ? <div className="loading-inline">{t("Loading queue…")}</div> : <div className="request-list">{queue.length ? queue.map((request, index) => <RequestCard key={request.id} request={request} position={index + 1} onFinish={() => finishRequest(request.id)} finishing={finishingId === request.id} finishDisabled={busy || !!finishingId}/>) : <Empty icon={<ClipboardList size={22}/>} title={t("The queue is empty")} text={t("Requests for this event will appear here as they come in.")}/>}</div>}</>}
        {admin && view === 'groups' && <GroupManagement groups={groups} onReload={async () => {await Promise.all([loadGroups(), loadEvents()]);}}/>}
        {view === 'settings' && <Settings/>}
      </main>
    </div>
  </div>;
}


function Settings() {
  const { t, i18n: currentI18n } = useTranslation();
  const { appearance, setAppearance } = useAppearance();
  const labels = {auto: 'Auto', dark: 'Dark', bright: 'Bright'} as const;
  return <><div className="page-heading"><h1>{t('Settings')}</h1></div><section className="panel settings-panel" aria-labelledby="preferences-title">
    <div className="panel-title"><h2 id="preferences-title">{t('Preferences')}</h2></div>
    <div className="settings-field"><div><label htmlFor="preferred-language">{t('Language')}</label><p>{t('Language and appearance are saved in this browser.')}</p></div>
      <select id="preferred-language" value={supportedLanguage(currentI18n.resolvedLanguage ?? currentI18n.language)} onChange={event => void changeLanguage(event.target.value as Language)}>
        <option value="en" lang="en">English</option><option value="zh" lang="zh">中文</option><option value="ja" lang="ja">日本語</option>
      </select>
    </div>
    <div className="settings-field"><div><span id="appearance-label" className="settings-label">{t('Appearance')}</span><p>{t('Appearance follows your device in Auto mode.')}</p></div>
      <div className="appearance-toggle" role="group" aria-labelledby="appearance-label">{appearances.map(value => <button type="button" key={value} aria-pressed={appearance === value} className={appearance === value ? 'selected' : ''} onClick={() => setAppearance(value)}>{t(labels[value])}</button>)}</div>
    </div>
  </section><section className="panel settings-panel about-panel" aria-labelledby="about-title">
    <div className="panel-title"><h2 id="about-title">{t('About')}</h2></div>
    <div className="settings-field"><span className="settings-label">{t('Version')}</span><span className="about-version">{version}</span></div>
    <p className="about-copyright">{t('copyrightNotice', {year: new Date().getFullYear()})}</p>
  </section></>;
}

function Login({onSubmit, busy, error}: {onSubmit: (email: string, password: string) => void; busy: boolean; error: string}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  return <main className="login-page"><div className="login-card"><img className="login-icon" src={daikoLogo} alt=""/><h1>{t("Login")}</h1>{error && <div className="alert error" role="alert">{t(error, {defaultValue: error})}</div>}<form onSubmit={e => {e.preventDefault(); onSubmit(email, password);}}><label>{t("Email")}<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com"/></label><label>{t("Password")}<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required placeholder={t("Enter your password")}/></label><button className="button primary full" disabled={busy}>{busy ? t('Signing in…') : t('Sign in')} <ArrowRight size={16}/></button></form><div className="login-divider"/><p className="login-help">{t("Use your ParcelHub account to sign in.")}<br/><a href={window.location.hostname === 'localhost' ? 'http://localhost:5173/auth' : 'https://parcelhub.nekoj.in/auth'}>{t("Create an account or manage your password")} <ArrowRight size={13}/></a></p></div></main>;
}
function EventCard({event, onClick, admin = false}: {event: Event; onClick: () => void; admin?: boolean}) {
  const { t } = useTranslation();
  const [broken, setBroken] = useState(false);
  return <button className="event-card" onClick={onClick}><div className="event-image">{event.imageUrl && !broken ? <img src={event.imageUrl} alt="" onError={() => setBroken(true)}/> : <div className="image-placeholder"><Sparkles size={23}/><span>DAIKO EVENT</span></div>}</div><div className="event-info"><div className="event-date"><CalendarDays size={14}/>{eventDate(event.startsAt)} <span>·</span> {time(event.startsAt)}</div><h3>{event.name}</h3><p>{event.groupName}</p>{admin && <span className="queue-count">{t('requestCount', {count: event.requestCount ?? 0})}</span>}</div><div className="event-action"><span>{admin ? t('View queue') : t('Make a request')}</span><ChevronRight size={18}/></div></button>;
}
function CreateEvent({onBack, onSubmit, busy, groups}: {onBack: () => void; onSubmit: (values: {name: string; groupId: string; startsAt: string; imageUrl: string}) => void; busy: boolean; groups: Group[]}) {
  const { t } = useTranslation();
 const [name, setName] = useState('');
 const [groupId, setGroupId] = useState('');
 const [startsAt, setStartsAt] = useState('');
 const [eventUrl, setEventUrl] = useState('');
 const [manualImageUrl, setManualImageUrl] = useState('');
 const [importedImageUrl, setImportedImageUrl] = useState('');
 const [imageFailed, setImageFailed] = useState(false);
 const [importStatus, setImportStatus] = useState<'idle' | 'waiting' | 'loading' | 'success' | 'error'>('idle');
 const [importMessage, setImportMessage] = useState('');
 const importTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
 const importController = useRef<AbortController | null>(null);
 const importSequence = useRef(0);
 const lastAttempt = useRef('');
 const nameEdited = useRef(false);
 const imageEdited = useRef(false);
 const nameRevision = useRef(0);
 const imageRevision = useRef(0);
 const sourceUrl = eventImportUrl(eventUrl);
 const importing = importStatus === 'waiting' || importStatus === 'loading';
 const imageUrl = manualImageUrl.trim() || importedImageUrl;

 const fetchEvent = useCallback(async (url: string, retry = false) => {
   if (importTimer.current) clearTimeout(importTimer.current);
   if (!url || (!retry && lastAttempt.current === url)) return;
   importController.current?.abort();
   const controller = new AbortController();
   importController.current = controller;
   const sequence = ++importSequence.current;
   const startingNameRevision = nameRevision.current;
   const startingImageRevision = imageRevision.current;
   lastAttempt.current = url;
   setImportStatus('loading');
   setImportMessage('Fetching the event title and main image…');
   try {
     const result = await api<{name: string; imageUrl: string}>('/daiko-api/events/import', {
       method: 'POST', body: JSON.stringify({url}), signal: controller.signal,
     });
     if (controller.signal.aborted || sequence !== importSequence.current) return;
     const updateName = !nameEdited.current && nameRevision.current === startingNameRevision;
     const updateImage = !imageEdited.current && imageRevision.current === startingImageRevision;
     if (updateName) setName(result.name);
     if (updateImage) {
       setImportedImageUrl(result.imageUrl);
       setImageFailed(false);
     }
     setImportStatus('success');
     setImportMessage(updateName && updateImage
       ? 'Event title and main image fetched. Add the group, date and time below.'
       : 'Event details fetched. Your manual changes were kept; review the details below.');
   } catch (error) {
     if (controller.signal.aborted || sequence !== importSequence.current) return;
     setImportStatus('error');
     setImportMessage(errorText(error));
   } finally {
     if (sequence === importSequence.current) importController.current = null;
   }
 }, []);

 useEffect(() => {
   if (!sourceUrl) return;
   setImportStatus('waiting');
   setImportMessage('Preparing to fetch the event…');
   importTimer.current = setTimeout(() => void fetchEvent(sourceUrl), 500);
   return () => {
     if (importTimer.current) clearTimeout(importTimer.current);
     importController.current?.abort();
     importSequence.current += 1;
   };
 }, [sourceUrl, fetchEvent]);

 useEffect(() => setImageFailed(false), [imageUrl]);

 const changeEventUrl = (value: string) => {
   setEventUrl(value);
   if ((eventImportUrl(value) || value.trim()) === (sourceUrl || eventUrl.trim())) return;
   if (importTimer.current) clearTimeout(importTimer.current);
   importController.current?.abort();
   importSequence.current += 1;
   lastAttempt.current = '';
   setImportStatus('idle');
   setImportMessage('');
   if (!nameEdited.current) setName('');
   setImportedImageUrl('');
 };

 return <>
   <button className="back" onClick={onBack}><ArrowLeft size={16}/> {t("Event management")}</button>
   <div className="page-heading"><div><h1>{t("Add an event")}</h1></div></div>
   <form className="panel create-form" onSubmit={e => {
     e.preventDefault();
     if (busy || importing) return;
     const dateValue = new Date(String(new FormData(e.currentTarget).get('startsAt') || ''));
     if (!Number.isFinite(dateValue.getTime())) return;
     onSubmit({name: name.trim(), groupId, startsAt: dateValue.toISOString(), imageUrl});
   }}>
     <div className="event-import">
       <label htmlFor="event-source-url">{t("TicketDive or LivePocket event URL")}</label>
       <div className="event-import-row">
         <input id="event-source-url" type="text" inputMode="url" autoComplete="off" value={eventUrl} disabled={busy} placeholder="https://ticketdive.com/event/…" aria-describedby="event-import-help" onChange={e => changeEventUrl(e.target.value)} onBlur={() => {
           if (eventUrl.trim() && !sourceUrl) {
             setImportStatus('error');
             setImportMessage('Use an HTTPS TicketDive /event/ link or LivePocket /e/ link. You can also enter the details manually.');
           }
         }} onKeyDown={e => {
           if (e.key === 'Enter') {
             e.preventDefault();
             if (sourceUrl && !importing && !busy) void fetchEvent(sourceUrl, true);
           }
         }}/>
         <button type="button" className="button secondary" disabled={busy || importing || !sourceUrl} onClick={() => void fetchEvent(sourceUrl, true)}>{importing ? <><span className="spinner" aria-hidden="true"/> {t("Fetching…")}</> : importStatus === 'error' ? t('Retry fetch') : t('Fetch details')}</button>
       </div>
       <p id="event-import-help" className="field-help">{t("The event title and original main image are fetched automatically. You can edit the details below.")}</p>
       {importMessage && <div className={`import-status ${importStatus}`} role={importStatus === 'error' ? 'alert' : 'status'}>{importStatus === 'success' && <Check size={15} aria-hidden="true"/>}<span>{t(importMessage, {defaultValue: importMessage})}{importStatus === 'error' && importMessage !== 'Use an HTTPS TicketDive /event/ link or LivePocket /e/ link. You can also enter the details manually.' ? ` ${t('You can retry or enter the details manually.')}` : ''}</span></div>}
     </div>
     <div className="panel-title"><h2>{t("Event details")}</h2></div>
     <label>{t("Event name")} <span className="required">*</span><input required maxLength={200} value={name} onChange={e => {nameEdited.current = true; nameRevision.current += 1; setName(e.target.value);}} placeholder={t("e.g. Spring Live 2026")}/></label>
     <label>{t("Group name")} <span className="required">*</span><select required value={groupId} onChange={e => setGroupId(e.target.value)}><option value="">{t("Select a group")}</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select>{groups.length === 0 && <small>{t("Add a group in Manage groups first.")}</small>}</label>
     <label>{t("Date and time")} <span className="required">*</span><input required type="datetime-local" name="startsAt" value={startsAt} onInput={e => setStartsAt(e.currentTarget.value)}/><small>{t("Shown in your local time.")}</small></label>
     <label>{t("Main visual URL")}<input type="url" value={manualImageUrl} onChange={e => {imageEdited.current = true; imageRevision.current += 1; setImportedImageUrl(''); setManualImageUrl(e.target.value);}} placeholder="https://example.com/event-image.jpg"/><small>{importedImageUrl ? t('Main image imported. Enter a direct image URL to replace it.') : t('Optional. Use a direct image link if you want to add your own visual.')}</small></label>
     {imageUrl && <div className="event-image-preview">
       {imageFailed ? <p className="preview"><ImageIcon size={16} aria-hidden="true"/> {t("Unable to preview this image. Check the URL or try fetching again.")}</p> : <img src={imageUrl} alt={name ? t('imageAlt', {name}) : t('Event main visual preview')} onError={() => setImageFailed(true)}/>}
       <div className="preview-caption"><span>{importedImageUrl ? t('Imported main visual') : t('Main visual preview')}</span><button type="button" className="text-button" onClick={() => {imageEdited.current = true; imageRevision.current += 1; setImportedImageUrl(''); setManualImageUrl('');}}>{t("Remove image")}</button></div>
     </div>}
     <div className="form-actions"><button type="button" className="button secondary" onClick={onBack}>{t("Cancel")}</button><button className="button primary" disabled={busy || importing || !name.trim() || !groupId}>{busy ? t('Adding…') : t('Add event')} <ArrowRight size={16}/></button></div>
   </form>
 </>;
}

function eventImportUrl(value: string): string {
 try {
   const url = new URL(value.trim());
   if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
   const ticketDive = ['ticketdive.com', 'www.ticketdive.com'].includes(url.hostname) && /^\/event\/[a-z\d_-]+\/?$/i.test(url.pathname);
   const livePocket = ['livepocket.jp', 't.livepocket.jp'].includes(url.hostname) && /^\/e\/[a-z\d_-]+\/?$/i.test(url.pathname);
   return ticketDive || livePocket ? `${url.origin}${url.pathname.replace(/\/$/, '')}` : '';
 } catch { return ''; }
}
function RequestCard({request, position, onFinish, finishing, finishDisabled}: {request: RequestItem; position?: number; onFinish?: () => void; finishing?: boolean; finishDisabled?: boolean}) {
  const { t } = useTranslation();
 return <article className="request-card"><div className="request-top"><div className="request-meta">{position && <span className="position">{String(position).padStart(2, '0')}</span>}<span className="badge">{request.offeringName || (request.type === 'CHEKI' ? t('Cheki') : t('Goods'))}</span>{request.amount != null && <span className="amount">× {request.amount}</span>}{request.finishedAt && <span className="badge finished-badge">{t('Finished')}</span>}</div><time><Clock3 size={14}/>{submitted(request.createdAt)}</time></div>{request.event && <><h3>{request.event.name}</h3><p className="request-subtitle">{request.event.groupName} · {eventDate(request.event.startsAt)}</p></>}{request.user && <div className="request-user"><UserRound size={15}/><strong>{request.user.name}</strong><span>{request.user.email}</span></div>}{request.memberName && <div className="request-member">{t("Member")}: <strong>{request.memberName}</strong></div>}<p className="request-message">{request.message}</p>{request.imageUrl && <a className="request-attachment" href={request.imageUrl} target="_blank" rel="noopener noreferrer"><img src={request.imageUrl} alt={t("Attached image")}/></a>}{onFinish && <div className="request-actions"><button type="button" className="button secondary" onClick={onFinish} disabled={finishDisabled}><Check size={15}/> {finishing ? t('Finishing…') : t('Finish')}</button></div>}</article>;
}
function Empty({icon, title, text}: {icon: React.ReactNode; title: string; text: string}) {return <div className="empty"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{text}</p></div>;}
export default App;


