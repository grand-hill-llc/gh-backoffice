import { Tag, type TagTone } from "../../components/ui";
import type { Channel, PostStatus } from "../../lib/social";
import { useT } from "../../i18n";

const TONE: Record<PostStatus, TagTone> = { draft: "neutral", pending: "warning", scheduled: "strong", published: "success" };

export function PostStatusTag({ status }: { status: PostStatus }) {
  const t = useT();
  return <Tag tone={TONE[status]}>{t.content.statuses[status]}</Tag>;
}

/** Short network marks ("FB IG"), with the full names for screen readers. */
export function ChannelBadges({ channels }: { channels: Channel[] }) {
  const t = useT();
  if (!channels.length) return null;
  return (
    <span className="channel-badges" aria-label={channels.map((c) => t.content.channels[c]).join(", ")}>
      {channels.map((c) => (
        <span key={c} className="channel-badge" aria-hidden="true">{t.content.channelShort[c]}</span>
      ))}
    </span>
  );
}
