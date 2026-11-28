import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import {
  CAPTION_LIMITS,
  CHANNELS,
  isoToLocal,
  isVideo,
  localToIso,
  MEDIA_BUCKET,
  MEDIA_MAX_BYTES,
  MEDIA_TYPES,
  mediaPathFor,
  POST_COLUMNS,
  postWarnings,
  type Channel,
  type PostMedia,
  type PostStatus,
  type PostWarning,
  type SocialPost,
} from "../../lib/social";
import { ownerName } from "../../lib/leads";
import { useAuth } from "../../auth/AuthProvider";
import { PageHeader } from "../../components/ui";
import DeleteZone from "../../components/DeleteZone";
import { AlertCircleIcon, CheckCircleIcon } from "../Icons";
import { useT, type Dict } from "../../i18n";
import { PostStatusTag } from "./contentShared";

type Values = { title: string; body: string; channels: Channel[]; when: string; notes: string; published_url: string };
type Item =
  | { key: string; kind: "saved"; row: PostMedia; url: string | null; mime: string }
  | { key: string; kind: "new"; file: File; url: string; mime: string };
type Person = { id: string; full_name: string | null; email: string | null };

const URL_RE = /^https?:\/\/\S+$/i;

function warningText(w: PostWarning, c: Dict["content"]): string {
  switch (w.kind) {
    case "tooLong":
      return c.warnings.tooLong(c.channels[w.channel], w.limit);
    case "instagramTooMany":
      return c.warnings.instagramTooMany(w.max);
    default:
      return c.warnings[w.kind];
  }
}

/** Create (/contenido/nuevo) and edit (/contenido/:id) a post, and move it through its statuses. */
export default function PostForm() {
  const { id } = useParams();
  const editing = !!id;
  const t = useT();
  const c = t.content;
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const { profile } = useAuth();
  const isSuper = profile?.role === "super_admin";

  const startDay = /^\d{4}-\d{2}-\d{2}$/.test(params.get("fecha") ?? "") ? params.get("fecha") : null;
  const empty: Values = { title: "", body: "", channels: [], when: startDay ? `${startDay}T10:00` : "", notes: "", published_url: "" };
  const [values, setValues] = useState<Values>(empty);
  const [post, setPost] = useState<SocialPost | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [removed, setRemoved] = useState<PostMedia[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [approvalOn, setApprovalOn] = useState(false);
  const [loading, setLoading] = useState(editing);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>((location.state as { message?: string } | null)?.message ?? null);
  const [touched, setTouched] = useState<"none" | "draft" | "schedule">("none");
  const [panel, setPanel] = useState<"none" | "sendBack" | "publish">("none");
  const [note, setNote] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("app_settings")
      .select("posts_require_approval")
      .maybeSingle()
      .then(({ data }) => setApprovalOn(!!(data as { posts_require_approval?: boolean } | null)?.posts_require_approval));
  }, []);

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      const [p, m] = await Promise.all([
        supabase.from("social_posts").select(POST_COLUMNS).eq("id", id).maybeSingle(),
        supabase.from("social_post_media").select("id, post_id, position, path, mime_type, size_bytes").eq("post_id", id).order("position"),
      ]);
      if (!active) return;
      setLoading(false);
      if (p.error || !p.data) return setLoadFailed(true);
      const row = p.data as SocialPost;
      const media = (m.data ?? []) as PostMedia[];
      setPost(row);
      setValues({
        title: row.title,
        body: row.body,
        channels: row.channels,
        when: row.scheduled_at ? isoToLocal(row.scheduled_at) : "",
        notes: row.notes ?? "",
        published_url: row.published_url ?? "",
      });
      setRemoved([]);
      const signed = media.length ? (await supabase.storage.from(MEDIA_BUCKET).createSignedUrls(media.map((x) => x.path), 3600)).data ?? [] : [];
      if (!active) return;
      setItems(media.map((r, i) => ({ key: r.id, kind: "saved", row: r, url: signed[i]?.signedUrl ?? null, mime: r.mime_type })));
    })();
    return () => {
      active = false;
    };
  }, [id]);

  // Names for "created by" and "sent back by", fetched when a new person appears.
  const creator = post?.created_by ?? null;
  const reviewer = post?.reviewed_by ?? null;
  useEffect(() => {
    const ids = [creator, reviewer].filter((x): x is string => !!x && !people.some((p) => p.id === x));
    if (!ids.length) return;
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", ids)
      .then(({ data }) => setPeople((p) => [...p, ...((data ?? []) as Person[]).filter((x) => !p.some((y) => y.id === x.id))]));
  }, [creator, reviewer, people]);

  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((v) => ({ ...v, [key]: value }));
  const toggleChannel = (ch: Channel) =>
    setValues((v) => ({ ...v, channels: v.channels.includes(ch) ? v.channels.filter((x) => x !== ch) : CHANNELS.filter((x) => x === ch || v.channels.includes(x)) }));

  const status: PostStatus = post?.status ?? "draft";
  const needsApproval = approvalOn && !isSuper;
  const scheduledAt = values.when ? localToIso(values.when) : null;
  const warnings = useMemo(
    () => postWarnings({ body: values.body, channels: values.channels, scheduled_at: scheduledAt, status }, items.map((i) => ({ mime_type: i.mime }))),
    [values.body, values.channels, scheduledAt, status, items],
  );
  const length = [...values.body].length;

  const titleError = touched !== "none" && !values.title.trim() ? c.titleRequired : null;
  const channelsError = touched === "schedule" && values.channels.length === 0 ? c.networksRequired : null;
  const whenError = touched === "schedule" && !values.when && status !== "published" ? c.whenRequired : null;
  const urlError = values.published_url.trim() && !URL_RE.test(values.published_url.trim()) ? c.urlInvalid : null;

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const errs: string[] = [];
    const add: Item[] = [];
    for (const f of Array.from(files)) {
      if (!MEDIA_TYPES.includes(f.type)) errs.push(c.mediaBadType(f.name));
      else if (f.size > MEDIA_MAX_BYTES) errs.push(c.mediaTooBig(f.name));
      else add.push({ key: crypto.randomUUID(), kind: "new", file: f, url: URL.createObjectURL(f), mime: f.type });
    }
    setFileErrors(errs);
    setItems((x) => [...x, ...add]);
  };
  const move = (i: number, by: number) =>
    setItems((x) => {
      const next = [...x];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });
  const remove = (i: number) =>
    setItems((x) => {
      const it = x[i];
      if (it.kind === "saved") setRemoved((r) => [...r, it.row]);
      else URL.revokeObjectURL(it.url);
      return x.filter((_, j) => j !== i);
    });

  /** Saves the post (and its files) with the status asked for; the database may turn "scheduled" into "pending". */
  const save = async (target: PostStatus, extra: { review_note?: string } = {}) => {
    setError(null);
    setMessage(null);
    const scheduling = target === "scheduled" || target === "pending";
    setTouched(scheduling || target === "published" ? "schedule" : "draft");
    if (!values.title.trim()) return;
    if ((scheduling || target === "published") && values.channels.length === 0) return;
    if (scheduling && !values.when) return;
    if (urlError) return;

    const blank = (v: string) => (v.trim() ? v.trim() : null);
    const payload: Record<string, unknown> = {
      title: values.title.trim(),
      body: values.body,
      channels: values.channels,
      scheduled_at: scheduledAt,
      notes: blank(values.notes),
      status: target,
      published_url: target === "published" ? blank(values.published_url) : null,
      ...extra,
    };
    setBusy(true);
    const res = editing
      ? await supabase.from("social_posts").update(payload).eq("id", id!).select(POST_COLUMNS).single()
      : await supabase.from("social_posts").insert(payload).select(POST_COLUMNS).single();
    if (res.error || !res.data) {
      setBusy(false);
      return setError(/aprobaci/i.test(res.error?.message ?? "") ? c.needsApproval : c.saveFailed);
    }
    const saved = res.data as SocialPost;

    // Files: removals, uploads, then the order.
    let mediaOk = true;
    if (removed.length) {
      const del = await supabase.from("social_post_media").delete().in("id", removed.map((r) => r.id));
      if (del.error) mediaOk = false;
      else await supabase.storage.from(MEDIA_BUCKET).remove(removed.map((r) => r.path));
    }
    const finalItems: Item[] = [];
    for (const it of items) {
      if (it.kind === "saved") {
        finalItems.push(it);
        continue;
      }
      const path = mediaPathFor(saved.id, it.file.name);
      const up = await supabase.storage.from(MEDIA_BUCKET).upload(path, it.file, { contentType: it.file.type });
      if (up.error) {
        mediaOk = false;
        continue;
      }
      const ins = await supabase
        .from("social_post_media")
        .insert({ post_id: saved.id, path, mime_type: it.file.type, size_bytes: it.file.size, position: finalItems.length })
        .select("id, post_id, position, path, mime_type, size_bytes")
        .single();
      if (ins.error || !ins.data) {
        mediaOk = false;
        await supabase.storage.from(MEDIA_BUCKET).remove([path]);
        continue;
      }
      finalItems.push({ key: ins.data.id, kind: "saved", row: ins.data as PostMedia, url: it.url, mime: it.mime });
    }
    for (const [pos, it] of finalItems.entries()) {
      if (it.kind === "saved" && it.row.position !== pos) {
        const r = await supabase.from("social_post_media").update({ position: pos }).eq("id", it.row.id);
        if (r.error) mediaOk = false;
        else it.row = { ...it.row, position: pos };
      }
    }

    // New media can send a scheduled post back to approval: read the final status.
    const final = (await supabase.from("social_posts").select(POST_COLUMNS).eq("id", saved.id).single()).data as SocialPost | null;
    const result = final ?? saved;
    setBusy(false);

    const msg =
      target === "published"
        ? c.publishedMsg
        : result.status === "pending" && status !== "pending"
          ? c.submittedMsg
          : target === "scheduled" && result.status === "scheduled" && status === "pending"
            ? c.approvedMsg
            : target === "scheduled" && result.status === "scheduled" && status !== "scheduled"
              ? c.scheduledMsg
              : target === "draft" && extra.review_note
                ? c.sentBackMsg
                : target === "draft" && status !== "draft"
                  ? c.draftMsg
                  : c.saved;

    if (!editing) return navigate(`/contenido/${saved.id}`, { replace: true, state: { message: mediaOk ? msg : null, mediaError: !mediaOk } });
    setPost(result);
    setItems(finalItems);
    setRemoved([]);
    setPanel("none");
    setNote("");
    setTouched("none");
    if (mediaOk) setMessage(msg);
    else setError(c.mediaFailed);
  };

  useEffect(() => {
    if ((location.state as { mediaError?: boolean } | null)?.mediaError) setError(c.mediaFailed);
  }, [location.state, c.mediaFailed]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save(editing ? status : "draft");
  };

  const onDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    const paths = [...items.filter((i) => i.kind === "saved").map((i) => (i as Extract<Item, { kind: "saved" }>).row.path), ...removed.map((r) => r.path)];
    const { error } = await supabase.from("social_posts").delete().eq("id", id!);
    if (error) {
      setDeleting(false);
      return setDeleteError(c.deleteFailed);
    }
    if (paths.length) await supabase.storage.from(MEDIA_BUCKET).remove(paths);
    navigate("/contenido", { replace: true });
  };

  const person = (uid: string | null) => ownerName(people.find((p) => p.id === uid));
  const formatAt = (iso: string) =>
    new Date(iso).toLocaleString(t.locale, { timeZone: "America/New_York", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

  if (loading) return <p className="gh-muted" role="status">{t.common.loading}</p>;
  if (loadFailed)
    return (
      <div className="gh-notice is-error" role="alert">
        <AlertCircleIcon />
        <p>
          {c.notFound} <Link to="/contenido">{c.title}</Link>
        </p>
      </div>
    );

  const scheduleLabel = needsApproval ? c.submit : c.schedule;

  return (
    <>
      <Link className="back-link" to="/contenido">← {c.back}</Link>
      <div className="detail-header">
        <PageHeader title={editing ? post?.title || c.editTitle : c.newTitle} />
        {post && (
          <div className="detail-meta">
            <PostStatusTag status={post.status} />
            {post.status === "published" && post.published_at && <span className="gh-small gh-muted">{c.publishedOn(formatAt(post.published_at))}</span>}
            {post.published_url && (
              <a className="gh-small" href={post.published_url} target="_blank" rel="noreferrer">{c.viewPost}</a>
            )}
            {post.created_by && <span className="gh-small gh-muted">{c.by(person(post.created_by))}</span>}
          </div>
        )}
      </div>

      {post?.review_note && post.status !== "scheduled" && post.status !== "published" && (
        <div className="gh-notice is-warning" role="note">
          <AlertCircleIcon />
          <p>
            <strong>{c.reviewNote(person(post.reviewed_by))}:</strong> {post.review_note}
          </p>
        </div>
      )}

      <form className="gh-form panel-form" onSubmit={onSubmit} noValidate>
        <fieldset className="form-section">
          <legend className="gh-label">{c.sectionContent}</legend>
          <div className={`gh-field${titleError ? " is-error" : ""}`}>
            <label className="gh-field-label" htmlFor="post-title">{c.postTitle}</label>
            <input
              id="post-title"
              className="gh-input"
              autoFocus={!editing}
              autoComplete="off"
              maxLength={200}
              value={values.title}
              onChange={(e) => set("title", e.target.value)}
              aria-invalid={!!titleError}
              aria-describedby={titleError ? "post-title-error" : "post-title-help"}
            />
            {titleError ? <p className="gh-error" id="post-title-error">{titleError}</p> : <p className="gh-help" id="post-title-help">{c.postTitleHelp}</p>}
          </div>

          <div className={`gh-field${channelsError ? " is-error" : ""}`} role="group" aria-labelledby="post-networks-label">
            <span className="gh-field-label" id="post-networks-label">{c.networks}</span>
            <div className="chip-group">
              {CHANNELS.map((ch) => (
                <button key={ch} type="button" className="chip" aria-pressed={values.channels.includes(ch)} onClick={() => toggleChannel(ch)}>
                  {c.channels[ch]}
                </button>
              ))}
            </div>
            {channelsError && <p className="gh-error">{channelsError}</p>}
          </div>

          <div className="gh-field">
            <label className="gh-field-label" htmlFor="post-body">{c.body}</label>
            <textarea
              id="post-body"
              className="gh-input gh-textarea"
              rows={7}
              placeholder={c.bodyPlaceholder}
              value={values.body}
              onChange={(e) => set("body", e.target.value)}
              aria-describedby="post-body-counters"
            />
            <p className="post-counters gh-small" id="post-body-counters" aria-live="polite">
              {values.channels
                .filter((ch) => ch !== "facebook")
                .map((ch) => (
                  <span key={ch} className={length > CAPTION_LIMITS[ch] ? "is-over" : undefined}>
                    {c.channels[ch]} {c.counter(length, CAPTION_LIMITS[ch])}
                  </span>
                ))}
            </p>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend className="gh-label">{c.sectionMedia}</legend>
          {items.length > 0 && (
            <ul className="media-grid">
              {items.map((it, i) => (
                <li key={it.key} className="media-item">
                  <div className="media-thumb">
                    {it.url ? (
                      isVideo(it.mime) ? <video src={it.url} muted preload="metadata" /> : <img src={it.url} alt="" />
                    ) : null}
                    {i === 0 && <span className="media-cover">1</span>}
                  </div>
                  <div className="media-actions">
                    <button type="button" className="media-move" onClick={() => move(i, -1)} disabled={i === 0} aria-label={c.moveEarlier}>←</button>
                    <button type="button" className="media-move" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label={c.moveLater}>→</button>
                    <button type="button" className="gh-link danger-link" onClick={() => remove(i)}>{c.removeMedia}</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="gh-field">
            <label className="gh-field-label" htmlFor="post-media">{c.addMedia}</label>
            <input
              id="post-media"
              className="gh-input gh-file"
              type="file"
              multiple
              accept={MEDIA_TYPES.join(",")}
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
              aria-describedby="post-media-help"
            />
            <p className="gh-help" id="post-media-help">{c.mediaHelp}</p>
            {fileErrors.map((m) => (
              <p key={m} className="gh-error">{m}</p>
            ))}
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend className="gh-label">{c.sectionWhen}</legend>
          {status === "published" ? (
            <div className={`gh-field${urlError ? " is-error" : ""}`}>
              <label className="gh-field-label" htmlFor="post-url">{c.publishedUrl}</label>
              <input id="post-url" className="gh-input" type="url" inputMode="url" value={values.published_url} onChange={(e) => set("published_url", e.target.value)} aria-invalid={!!urlError} />
              {urlError ? <p className="gh-error">{urlError}</p> : <p className="gh-help">{c.publishedUrlHelp}</p>}
            </div>
          ) : (
            <div className={`gh-field post-when${whenError ? " is-error" : ""}`}>
              <label className="gh-field-label" htmlFor="post-when">{c.when}</label>
              <input
                id="post-when"
                className="gh-input"
                type="datetime-local"
                value={values.when}
                onChange={(e) => set("when", e.target.value)}
                aria-invalid={!!whenError}
                aria-describedby={whenError ? "post-when-error" : "post-when-help"}
              />
              {whenError ? <p className="gh-error" id="post-when-error">{whenError}</p> : <p className="gh-help" id="post-when-help">{c.whenHelp}</p>}
            </div>
          )}
          <div className="gh-field">
            <label className="gh-field-label" htmlFor="post-notes">{c.notes}</label>
            <textarea id="post-notes" className="gh-input gh-textarea" rows={3} value={values.notes} onChange={(e) => set("notes", e.target.value)} aria-describedby="post-notes-help" />
            <p className="gh-help" id="post-notes-help">{c.notesHelp}</p>
          </div>
        </fieldset>

        {warnings.length > 0 && (
          <div className="gh-notice is-warning" role="status">
            <AlertCircleIcon />
            {warnings.length === 1 ? (
              <p>{warningText(warnings[0], c)}</p>
            ) : (
              <ul className="notice-list">
                {warnings.map((w) => (
                  <li key={w.kind + ("channel" in w ? w.channel : "")}>{warningText(w, c)}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {panel === "sendBack" && (
          <div className="gh-field confirm-box is-neutral">
            <label className="gh-field-label" htmlFor="post-review-note">{c.sendBackNote}</label>
            <textarea id="post-review-note" className="gh-input gh-textarea" rows={3} maxLength={2000} autoFocus value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="form-actions">
              <button className="gh-btn gh-btn-primary gh-btn-sm" type="button" disabled={busy || !note.trim()} onClick={() => save("draft", { review_note: note.trim() })}>
                {c.sendBackConfirm}
              </button>
              <button className="gh-link" type="button" onClick={() => setPanel("none")}>{t.common.cancel}</button>
            </div>
          </div>
        )}

        {panel === "publish" && (
          <div className={`gh-field confirm-box is-neutral${urlError ? " is-error" : ""}`}>
            <label className="gh-field-label" htmlFor="post-publish-url">{c.publishedUrl}</label>
            <input
              id="post-publish-url"
              className="gh-input"
              type="url"
              inputMode="url"
              autoFocus
              placeholder="https://"
              value={values.published_url}
              onChange={(e) => set("published_url", e.target.value)}
              aria-invalid={!!urlError}
            />
            {urlError ? <p className="gh-error">{urlError}</p> : <p className="gh-help">{c.publishedUrlHelp}</p>}
            <div className="form-actions">
              <button className="gh-btn gh-btn-primary gh-btn-sm" type="button" disabled={busy || !!urlError} onClick={() => save("published")}>
                {c.confirmPublished}
              </button>
              <button className="gh-link" type="button" onClick={() => setPanel("none")}>{t.common.cancel}</button>
            </div>
          </div>
        )}

        {error && (
          <div className="gh-notice is-error" role="alert">
            <AlertCircleIcon />
            <p>{error}</p>
          </div>
        )}
        {message && !error && (
          <div className="gh-notice is-success" role="status">
            <CheckCircleIcon />
            <p>{message}</p>
          </div>
        )}

        {panel === "none" && (
          <>
            <div className="form-actions">
              {status === "draft" && (
                <>
                  <button className="gh-btn gh-btn-primary" type="button" disabled={busy} onClick={() => save("scheduled")}>
                    {busy ? t.common.saving : scheduleLabel}
                  </button>
                  <button className="gh-btn gh-btn-secondary" type="submit" disabled={busy}>{c.saveDraft}</button>
                </>
              )}
              {status === "pending" && isSuper && (
                <>
                  <button className="gh-btn gh-btn-primary" type="button" disabled={busy} onClick={() => save("scheduled")}>
                    {busy ? t.common.saving : c.approve}
                  </button>
                  <button className="gh-btn gh-btn-secondary" type="button" disabled={busy} onClick={() => setPanel("sendBack")}>{c.sendBack}</button>
                  <button className="gh-btn gh-btn-secondary" type="submit" disabled={busy}>{c.saveChanges}</button>
                </>
              )}
              {status === "pending" && !isSuper && (
                <>
                  <button className="gh-btn gh-btn-primary" type="submit" disabled={busy}>{busy ? t.common.saving : c.saveChanges}</button>
                  <button className="gh-link" type="button" disabled={busy} onClick={() => save("draft")}>{c.toDraft}</button>
                </>
              )}
              {status === "scheduled" && (
                <>
                  <button className="gh-btn gh-btn-primary" type="submit" disabled={busy}>{busy ? t.common.saving : c.saveChanges}</button>
                  <button className="gh-btn gh-btn-secondary" type="button" disabled={busy} onClick={() => setPanel("publish")}>{c.markPublished}</button>
                  <button className="gh-link" type="button" disabled={busy} onClick={() => save("draft")}>{c.toDraft}</button>
                </>
              )}
              {status === "published" && (
                <button className="gh-btn gh-btn-primary" type="submit" disabled={busy}>{busy ? t.common.saving : c.saveChanges}</button>
              )}
              {!editing && <Link className="gh-link" to="/contenido">{t.common.cancel}</Link>}
            </div>
            {((status === "draft" && needsApproval) || status === "scheduled") && (
              <p className="gh-small gh-muted form-hint">{status === "draft" ? c.approvalOn : c.publishHint}</p>
            )}
          </>
        )}
      </form>

      {editing && (
        <DeleteZone
          label={c.deleteLabel}
          message={c.deleteMessage}
          confirmLabel={c.deleteConfirm}
          busyLabel={c.deleting}
          cancelLabel={t.common.cancel}
          error={deleteError}
          busy={deleting}
          onConfirm={onDelete}
        />
      )}
    </>
  );
}
