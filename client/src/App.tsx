import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Check, ChevronRight, ClipboardList, Clock3, Image as ImageIcon, Layers3, LogOut, Plus, Sparkles, Ticket, UserRound, X } from 'lucide-react';

type User = { id: string; name: string; email: string; role: string };
type Event = { id: string; name: string; groupName: string; startsAt: string; imageUrl: string | null; requestCount: number };
type RequestItem = { id: string; type: 'CHEKI' | 'GOODS'; amount: number | null; message: string; createdAt: string; user?: {name: string; email: string}; event?: Pick<Event, 'id' | 'name' | 'groupName' | 'startsAt'> };
type View = 'events' | 'requests' | 'admin';

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: 'include', ...options, headers: { ...(options.body ? {'Content-Type': 'application/json'} : {}), ...options.headers } });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || data.error || `Something went wrong (${response.status}).`);
  }
  return response.status === 204 ? undefined as T : response.json();
}
const post = <T,>(path: string, body: object = {}) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });
const date = (value: string, options: Intl.DateTimeFormatOptions) => new Date(value).toLocaleDateString(undefined, options);
const eventDate = (value: string) => date(value, {weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'});
const time = (value: string) => new Date(value).toLocaleString(undefined, {hour: 'numeric', minute: '2-digit'});
const submitted = (value: string) => new Date(value).toLocaleString(undefined, {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'});
const errorText = (e: unknown) => e instanceof Error ? e.message : 'Something went wrong. Please try again.';

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<Event[]>([]);
  const [myRequests, setMyRequests] = useState<RequestItem[]>([]);
  const [view, setView] = useState<View>('events');
  const [selected, setSelected] = useState<Event | null>(null);
  const [queueEvent, setQueueEvent] = useState<Event | null>(null);
  const [queue, setQueue] = useState<RequestItem[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const admin = user?.role?.toUpperCase() === 'ADMIN';

  const loadEvents = async () => { const result = await api<{events: Event[]}>('/daiko-api/events'); setEvents([...result.events].sort((a,b) => +new Date(a.startsAt) - +new Date(b.startsAt))); };
  const loadMyRequests = async () => { const result = await api<{requests: RequestItem[]}>('/daiko-api/my-requests'); setMyRequests(result.requests); };
  const initialize = async () => { const result = await api<{user: User | null}>('/daiko-api/session'); setUser(result.user); if (result.user) await Promise.all([loadEvents(), loadMyRequests()]); };
  useEffect(() => { initialize().catch(e => setError(errorText(e))).finally(() => setLoading(false)); }, []);
  const signIn = async (email: string, password: string) => { setBusy(true); setError(''); try { await post('/api/auth/sign-in/email', {email, password}); await initialize(); } catch(e) { setError(errorText(e)); } finally {setBusy(false);} };
  const signOut = async () => { setBusy(true); try { await post('/api/auth/sign-out'); setUser(null); setView('events'); setSelected(null); setQueueEvent(null); } catch(e) {setError(errorText(e));} finally {setBusy(false);} };
  const navigate = (next: View) => {setView(next); setSelected(null); setQueueEvent(null); setShowCreate(false); setError(''); setNotice('');};
  const selectQueue = async (event: Event) => {setQueueEvent(event); setError(''); setBusy(true); try {const result = await api<{requests: RequestItem[]}>(`/daiko-api/events/${event.id}/requests`); setQueue([...result.requests].sort((a,b) => +new Date(a.createdAt) - +new Date(b.createdAt)));} catch(e){setError(errorText(e));} finally {setBusy(false);} };

  if (loading) return <div className="loading"><span className="spinner"/> Loading Daiko…</div>;
  if (!user) return <Login onSubmit={signIn} busy={busy} error={error}/>;
  const firstName = user.name?.trim().split(/\s+/)[0] || 'there';
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Sparkles size={17}/></span><span>Daiko</span></div>
      <div className="nav-label">YOUR SPACE</div>
      <nav className="navigation" aria-label="Main navigation">
        <button className={view === 'events' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('events')}><CalendarDays size={17}/> Events</button>
        <button className={view === 'requests' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('requests')}><ClipboardList size={17}/> My requests</button>
        {admin && <><div className="nav-label admin-label">MANAGE</div><button className={view === 'admin' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('admin')}><Layers3 size={17}/> Event management</button></>}
      </nav>
      <div className="sidebar-bottom"><div className="profile"><span className="avatar">{(user.name || user.email).slice(0,1).toUpperCase()}</span><span className="profile-text"><strong>{user.name}</strong><small>{user.email}</small></span></div><button className="signout" onClick={signOut} disabled={busy}><LogOut size={16}/> Sign out</button></div>
    </aside>
    <div className="main-wrap">
      <header className="mobile-header"><div className="brand"><span className="brand-mark"><Sparkles size={16}/></span>Daiko</div><button className="icon-button" aria-label="Sign out" title="Sign out" onClick={signOut}><LogOut size={18}/></button></header>
      <div className="mobile-nav"><button className={view === 'events' ? 'active' : ''} onClick={() => navigate('events')}>Events</button><button className={view === 'requests' ? 'active' : ''} onClick={() => navigate('requests')}>My requests</button>{admin && <button className={view === 'admin' ? 'active' : ''} onClick={() => navigate('admin')}>Manage</button>}</div>
      <main className="content">
        {error && <div className="alert error" role="alert">{error}<button aria-label="Dismiss" onClick={() => setError('')}><X size={16}/></button></div>}
        {notice && <div className="alert success" role="status"><Check size={17}/>{notice}<button aria-label="Dismiss" onClick={() => setNotice('')}><X size={16}/></button></div>}
        {view === 'events' && !selected && <><div className="page-heading"><div><div className="eyebrow">YOUR REQUESTS, MADE SIMPLE</div><h1>Find your next event</h1><p>Hi {firstName}, choose an event to send in a daiko request.</p></div></div><div className="section-heading"><div><h2>Events</h2><p>Choose an event to get started</p></div><span className="count">{events.length} {events.length === 1 ? 'event' : 'events'}</span></div><div className="event-list">{events.length ? events.map(event => <EventCard key={event.id} event={event} onClick={() => {setError(''); setNotice(''); setSelected(event);}}/>) : <Empty icon={<CalendarDays size={22}/>} title="No events yet" text="Events will appear here once they’ve been added."/>}</div><div className="footnote"><Sparkles size={15}/> A little help getting closer to your favorite moments.</div></>}
        {view === 'events' && selected && <RequestForm event={selected} busy={busy} onBack={() => setSelected(null)} onSubmit={async (type, amount, message) => {setBusy(true); setError(''); try {await post(`/daiko-api/events/${selected.id}/requests`, {type, ...(type === 'CHEKI' ? {amount} : {}), message}); await Promise.all([loadEvents(), loadMyRequests()]); setSelected(null); setNotice('Your request has been submitted. You can find it in My requests.');} catch(e) {setError(errorText(e));} finally {setBusy(false);}}}/>}
        {view === 'requests' && <><div className="page-heading"><div><div className="eyebrow">YOUR ACTIVITY</div><h1>My requests</h1><p>A record of the requests you’ve sent in.</p></div><button className="button primary" onClick={() => navigate('events')}><Plus size={16}/> New request</button></div><div className="section-heading"><div><h2>Request history</h2><p>Your submitted requests, all in one place</p></div><span className="count">{myRequests.length} total</span></div><div className="request-list">{myRequests.length ? myRequests.map(request => <RequestCard key={request.id} request={request}/>) : <Empty icon={<ClipboardList size={22}/>} title="Nothing here yet" text="Once you submit a request, you’ll see it here."/>}</div></>}
        {view === 'admin' && !showCreate && !queueEvent && <><div className="page-heading"><div><div className="eyebrow">ADMINISTRATION</div><h1>Event management</h1><p>Add events and review incoming requests.</p></div><button className="button primary" onClick={() => setShowCreate(true)}><Plus size={16}/> Add event</button></div><div className="section-heading"><div><h2>All events</h2><p>Select an event to view its queue</p></div><span className="count">{events.length} {events.length === 1 ? 'event' : 'events'}</span></div><div className="event-list">{events.length ? events.map(event => <EventCard key={event.id} event={event} admin onClick={() => selectQueue(event)}/>) : <Empty icon={<CalendarDays size={22}/>} title="No events yet" text="Add your first event to start receiving requests."/>}</div></>}
        {view === 'admin' && showCreate && <CreateEvent busy={busy} onBack={() => setShowCreate(false)} onSubmit={async values => {setBusy(true); setError(''); try {await post('/daiko-api/events', values); await loadEvents(); setShowCreate(false); setNotice('Event added successfully.');} catch(e) {setError(errorText(e));} finally {setBusy(false);}}}/>}
        {view === 'admin' && queueEvent && <><button className="back" onClick={() => setQueueEvent(null)}><ArrowLeft size={16}/> All events</button><div className="page-heading"><div><div className="eyebrow">EVENT QUEUE</div><h1>{queueEvent.name}</h1><p>{queueEvent.groupName} <span className="dot">·</span> {eventDate(queueEvent.startsAt)}</p></div><span className="count">{queue.length} {queue.length === 1 ? 'request' : 'requests'}</span></div><div className="section-heading"><div><h2>Request queue</h2><p>Ordered by submission time, earliest first</p></div></div>{busy ? <div className="loading-inline">Loading queue…</div> : <div className="request-list">{queue.length ? queue.map((request, index) => <RequestCard key={request.id} request={request} position={index + 1}/>) : <Empty icon={<ClipboardList size={22}/>} title="The queue is empty" text="Requests for this event will appear here as they come in."/>}</div>}</>}
      </main>
    </div>
  </div>;
}

function Login({onSubmit, busy, error}: {onSubmit: (email: string, password: string) => void; busy: boolean; error: string}) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  return <main className="login-page"><div className="login-card"><div className="login-icon"><Sparkles size={22}/></div><h1>Welcome to Daiko</h1><p>Sign in to send and keep track of your requests.</p>{error && <div className="alert error" role="alert">{error}</div>}<form onSubmit={e => {e.preventDefault(); onSubmit(email, password);}}><label>Email<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com"/></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="Enter your password"/></label><button className="button primary full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'} <ArrowRight size={16}/></button></form><div className="login-divider"/><p className="login-help">Use your ParcelHub account to sign in.<br/><a href="https://parcelhub.nekoj.in/auth">Create an account or manage your password <ArrowRight size={13}/></a></p></div><p className="login-footer">A little closer to the moments that matter.</p></main>;
}
function EventCard({event, onClick, admin = false}: {event: Event; onClick: () => void; admin?: boolean}) {
  const [broken, setBroken] = useState(false);
  return <button className="event-card" onClick={onClick}><div className="event-image">{event.imageUrl && !broken ? <img src={event.imageUrl} alt="" onError={() => setBroken(true)}/> : <div className="image-placeholder"><Sparkles size={23}/><span>DAIKO EVENT</span></div>}</div><div className="event-info"><div className="event-date"><CalendarDays size={14}/>{eventDate(event.startsAt)} <span>·</span> {time(event.startsAt)}</div><h3>{event.name}</h3><p>{event.groupName}</p>{admin && <span className="queue-count">{event.requestCount ?? 0} requests</span>}</div><div className="event-action"><span>{admin ? 'View queue' : 'Make a request'}</span><ChevronRight size={18}/></div></button>;
}
function RequestForm({event, onBack, onSubmit, busy}: {event: Event; onBack: () => void; onSubmit: (type: 'CHEKI'|'GOODS', amount: number, message: string) => void; busy: boolean}) {
 const [type, setType] = useState<'CHEKI'|'GOODS'>('CHEKI'); const [amount, setAmount] = useState(1); const [message, setMessage] = useState('');
 return <><button className="back" onClick={onBack}><ArrowLeft size={16}/> Back to events</button><div className="page-heading"><div><div className="eyebrow">MAKE A REQUEST</div><h1>Tell us what you need</h1><p>Share the details below and your request will be added to the queue.</p></div></div><div className="form-layout"><form className="panel request-form" onSubmit={e => {e.preventDefault(); onSubmit(type, amount, message.trim());}}><div className="panel-title"><h2>Request details</h2><p>What would you like to request?</p></div><div className="type-picker"><button type="button" className={type === 'CHEKI' ? 'type-option selected' : 'type-option'} onClick={() => setType('CHEKI')}><span className="type-icon"><Ticket size={19}/></span><span><strong>Cheki</strong><small>Photo and message</small></span><span className="radio"/></button><button type="button" className={type === 'GOODS' ? 'type-option selected' : 'type-option'} onClick={() => setType('GOODS')}><span className="type-icon"><Sparkles size={19}/></span><span><strong>Goods</strong><small>Merchandise request</small></span><span className="radio"/></button></div>{type === 'CHEKI' && <label>Amount <span className="required">*</span><input type="number" min="1" max="1000" step="1" required value={amount} onChange={e => setAmount(Number(e.target.value))}/><small>How many cheki would you like?</small></label>}<label>{type === 'CHEKI' ? 'Message to the idol' : 'Request details'} <span className="required">*</span><textarea required minLength={1} maxLength={5000} rows={6} value={message} onChange={e => setMessage(e.target.value)} placeholder={type === 'CHEKI' ? 'Write the message you’d like to send…' : 'Tell us what goods you would like…'}/><small>{type === 'CHEKI' ? 'Include anything you’d like the idol to know.' : 'Please include the details needed to fulfill your request.'}</small></label><div className="form-actions"><button type="button" className="button secondary" onClick={onBack}>Cancel</button><button className="button primary" disabled={busy || !message.trim()}>{busy ? 'Submitting…' : 'Submit request'} <ArrowRight size={16}/></button></div></form><aside className="summary-card"><div className="summary-label">SELECTED EVENT</div><div className="summary-icon"><CalendarDays size={20}/></div><h3>{event.name}</h3><p>{event.groupName}</p><div className="summary-date"><CalendarDays size={15}/>{eventDate(event.startsAt)}<br/><Clock3 size={15}/>{time(event.startsAt)}</div></aside></div></>;
}
function CreateEvent({onBack, onSubmit, busy}: {onBack: () => void; onSubmit: (values: {name: string; groupName: string; startsAt: string; imageUrl: string}) => void; busy: boolean}) {
 const [name, setName] = useState(''); const [groupName, setGroupName] = useState(''); const [startsAt, setStartsAt] = useState(''); const [imageUrl, setImageUrl] = useState('');
 return <><button className="back" onClick={onBack}><ArrowLeft size={16}/> Event management</button><div className="page-heading"><div><div className="eyebrow">ADMINISTRATION</div><h1>Add an event</h1><p>Enter the details to make this event available for requests.</p></div></div><form className="panel create-form" onSubmit={e => {e.preventDefault(); onSubmit({name: name.trim(), groupName: groupName.trim(), startsAt: new Date(startsAt).toISOString(), imageUrl: imageUrl.trim()});}}><div className="panel-title"><h2>Event details</h2><p>You can add a main visual using an image URL.</p></div><label>Event name <span className="required">*</span><input required maxLength={200} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Spring Live 2026"/></label><label>Group name <span className="required">*</span><input required maxLength={200} value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Name of the group"/></label><label>Date and time <span className="required">*</span><input required type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)}/><small>Shown in your local time.</small></label><label>Main visual URL<input type="url" value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://example.com/event-image.jpg"/><small>Optional. Use a direct link to the event image.</small></label>{imageUrl && <div className="preview"><ImageIcon size={16}/> Image URL added</div>}<div className="form-actions"><button type="button" className="button secondary" onClick={onBack}>Cancel</button><button className="button primary" disabled={busy || !name.trim() || !groupName.trim()}>{busy ? 'Adding…' : 'Add event'} <ArrowRight size={16}/></button></div></form></>;
}
function RequestCard({request, position}: {request: RequestItem; position?: number}) {
 return <article className="request-card"><div className="request-top"><div className="request-meta">{position && <span className="position">{String(position).padStart(2, '0')}</span>}<span className="badge">{request.type === 'CHEKI' ? 'Cheki' : 'Goods'}</span>{request.type === 'CHEKI' && <span className="amount">× {request.amount}</span>}</div><time><Clock3 size={14}/>{submitted(request.createdAt)}</time></div>{request.event && <><h3>{request.event.name}</h3><p className="request-subtitle">{request.event.groupName} · {eventDate(request.event.startsAt)}</p></>}{request.user && <div className="request-user"><UserRound size={15}/><strong>{request.user.name}</strong><span>{request.user.email}</span></div>}<p className="request-message">{request.message}</p></article>;
}
function Empty({icon, title, text}: {icon: React.ReactNode; title: string; text: string}) {return <div className="empty"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{text}</p></div>;}
export default App;


