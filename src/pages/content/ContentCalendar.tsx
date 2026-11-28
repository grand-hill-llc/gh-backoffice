import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { dayOf, isoToLocal, monthGrid, POST_COLUMNS, postDate, shiftMonth, type SocialPost } from "../../lib/social";
import { PageHeader } from "../../components/ui";
import { AlertCircleIcon } from "../Icons";
import { useT } from "../../i18n";
import { ChannelBadges, PostStatusTag } from "./contentShared";

/** Month calendar of posts (Florida days), plus undated ideas and what awaits approval. */
export default function ContentCalendar() {
  const t = useT();
  const c = t.content;
  const [params, setParams] = useSearchParams();
  const today = dayOf(new Date().toISOString());
  const month = /^\d{4}-\d{2}$/.test(params.get("mes") ?? "") ? params.get("mes")! : today.slice(0, 7);
  const [posts, setPosts] = useState<SocialPost[] | null>(null);
  const [error, setError] = useState<"none" | "missing" | "failed">("none");

  useEffect(() => {
    let active = true;
    supabase
      .from("social_posts")
      .select(POST_COLUMNS)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) return setError(/schema cache|does not exist|relation/i.test(error.message) ? "missing" : "failed");
        setPosts((data ?? []) as SocialPost[]);
      });
    return () => {
      active = false;
    };
  }, []);

  const goTo = (m: string) => setParams(m === today.slice(0, 7) ? {} : { mes: m }, { replace: true });

  const byDay = useMemo(() => {
    const map = new Map<string, SocialPost[]>();
    for (const p of posts ?? []) {
      const at = postDate(p);
      if (!at) continue;
      const day = dayOf(at);
      map.set(day, [...(map.get(day) ?? []), p]);
    }
    for (const list of map.values()) list.sort((a, b) => (postDate(a) ?? "").localeCompare(postDate(b) ?? ""));
    return map;
  }, [posts]);

  const grid = monthGrid(month);
  const monthDays = grid.filter((d) => d.inMonth && byDay.has(d.day));
  const undated = (posts ?? []).filter((p) => !postDate(p)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const pending = (posts ?? []).filter((p) => p.status === "pending").sort((a, b) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? ""));

  const [y, m] = month.split("-").map(Number);
  const monthLabel = new Date(y, m - 1, 1).toLocaleDateString(t.locale, { month: "long", year: "numeric" });
  const dayLabel = (day: string, opts: Intl.DateTimeFormatOptions) => {
    const [yy, mm, dd] = day.split("-").map(Number);
    return new Date(yy, mm - 1, dd).toLocaleDateString(t.locale, opts);
  };
  const time = (p: SocialPost) => {
    const at = postDate(p);
    if (!at) return "";
    const [h, min] = isoToLocal(at).slice(11).split(":").map(Number);
    return new Date(2000, 0, 1, h, min).toLocaleTimeString(t.locale, { hour: "numeric", minute: "2-digit" });
  };

  const chip = (p: SocialPost) => (
    <Link key={p.id} to={`/contenido/${p.id}`} className={`cal-post is-${p.status}`} title={`${c.statuses[p.status]} · ${p.title}`}>
      <span className="cal-post-time">{time(p)}</span>
      <span className="cal-post-title">{p.title}</span>
      <ChannelBadges channels={p.channels} />
    </Link>
  );

  return (
    <>
      <div className="page-header-row">
        <PageHeader eyebrow={c.eyebrow} title={c.title} description={c.description} />
        <Link className="gh-btn gh-btn-primary" to="/contenido/nuevo">{c.newPost}</Link>
      </div>

      {error !== "none" ? (
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{error === "missing" ? c.missingTable : c.loadFailed}</p>
        </div>
      ) : !posts ? (
        <p className="gh-muted" role="status">{t.common.loading}</p>
      ) : (
        <div className="content-layout">
          <section className="cal" aria-label={monthLabel}>
            <div className="cal-head">
              <h2 className="gh-h4 cal-month">{monthLabel}</h2>
              <div className="cal-nav">
                <button className="gh-btn gh-btn-secondary gh-btn-sm" type="button" onClick={() => goTo(shiftMonth(month, -1))} aria-label={c.prevMonth}>‹</button>
                <button className="gh-btn gh-btn-secondary gh-btn-sm" type="button" onClick={() => goTo(today.slice(0, 7))} disabled={month === today.slice(0, 7)}>{c.today}</button>
                <button className="gh-btn gh-btn-secondary gh-btn-sm" type="button" onClick={() => goTo(shiftMonth(month, 1))} aria-label={c.nextMonth}>›</button>
              </div>
            </div>

            <div className="cal-grid" role="grid" aria-label={monthLabel}>
              <div className="cal-row" role="row">
                {c.weekdays.map((w) => (
                  <div key={w} className="cal-weekday" role="columnheader">{w}</div>
                ))}
              </div>
              {Array.from({ length: grid.length / 7 }, (_, week) => (
                <div className="cal-row" role="row" key={week}>
                  {grid.slice(week * 7, week * 7 + 7).map(({ day, inMonth }) => (
                    <div
                      key={day}
                      role="gridcell"
                      className={`cal-day${inMonth ? "" : " is-outside"}${day === today ? " is-today" : ""}`}
                      aria-label={dayLabel(day, { weekday: "long", day: "numeric", month: "long" })}
                    >
                      <div className="cal-day-head">
                        <span className="cal-day-num" aria-hidden="true">{Number(day.slice(8))}</span>
                        {day >= today && (
                          <Link className="cal-add" to={`/contenido/nuevo?fecha=${day}`} aria-label={c.addOn(dayLabel(day, { day: "numeric", month: "long" }))}>+</Link>
                        )}
                      </div>
                      {(byDay.get(day) ?? []).map(chip)}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* Narrow screens: the month as a list of days with posts. */}
            <div className="cal-agenda">
              {monthDays.length === 0 ? (
                <p className="gh-muted">{c.emptyMonth}</p>
              ) : (
                monthDays.map(({ day }) => (
                  <div key={day} className={`cal-agenda-day${day === today ? " is-today" : ""}`}>
                    <h3 className="gh-label">{dayLabel(day, { weekday: "short", day: "numeric", month: "short" })}</h3>
                    {(byDay.get(day) ?? []).map(chip)}
                  </div>
                ))
              )}
            </div>
            <p className="gh-small gh-muted cal-tz">{c.tzNote}</p>
          </section>

          <aside className="content-side">
            {pending.length > 0 && (
              <section className="panel">
                <div className="panel-head"><h2 className="gh-label panel-title">{c.pendingTitle}</h2></div>
                <ul className="side-list">
                  {pending.map((p) => (
                    <li key={p.id}>
                      <Link className="row-link" to={`/contenido/${p.id}`}>{p.title}</Link>
                      <span className="cell-sub">
                        {p.scheduled_at ? `${dayLabel(dayOf(p.scheduled_at), { day: "numeric", month: "short" })} · ${time(p)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section className="panel">
              <div className="panel-head"><h2 className="gh-label panel-title">{c.undatedTitle}</h2></div>
              {undated.length === 0 ? (
                <p className="panel-empty side-empty">{c.undatedEmpty}</p>
              ) : (
                <ul className="side-list">
                  {undated.map((p) => (
                    <li key={p.id}>
                      <Link className="row-link" to={`/contenido/${p.id}`}>{p.title}</Link>
                      <span className="side-meta">
                        <PostStatusTag status={p.status} />
                        <ChannelBadges channels={p.channels} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      )}
    </>
  );
}
