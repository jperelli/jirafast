import { useState } from "react";
import { useBaseUrl } from "../lib/store";
import { toAssetUrl } from "../lib/html";
import { initials } from "../lib/format";
import type { JiraUser } from "../lib/types";
import css from "./Avatar.module.css";

export default function Avatar({ user, size = 24 }: { user: JiraUser; size?: number }) {
  const baseUrl = useBaseUrl();
  const [failed, setFailed] = useState(false);
  const urls = user.avatarUrls;
  const raw = urls?.["48x48"] ?? urls?.["32x32"] ?? urls?.["24x24"] ?? urls?.["16x16"];
  const src = raw ? (toAssetUrl(raw, baseUrl) ?? raw) : null;

  if (src && !failed) {
    return (
      <img
        className={css.avatar}
        src={src}
        alt=""
        title={user.displayName}
        width={size}
        height={size}
        style={{ width: size, height: size }}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span
      className={`${css.avatar} ${css.fallback}`}
      title={user.displayName}
      style={{ width: size, height: size, fontSize: Math.max(8, size * 0.42) }}
    >
      {initials(user.displayName)}
    </span>
  );
}
