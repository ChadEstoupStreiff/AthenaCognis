import uuid

import streamlit as st
from utils import fmt_bytes


def disk_widget(disk_usage: dict) -> str:
    total = int(disk_usage.get("total", 0))
    available = int(disk_usage.get("available", 0))

    # Known parts (bytes)
    back = int(disk_usage.get("back", 0))
    ollama = int(disk_usage.get("ollama", 0))
    mysql = int(disk_usage.get("mysql", 0))
    files = int(disk_usage.get("files", 0))

    # Compute used & other
    used = max(total - available, 0)
    known = max(back, 0) + max(ollama, 0) + max(mysql, 0) + max(files, 0)
    other = int(disk_usage.get("other", max(used - known, 0)))

    # If total missing, infer from parts + available
    if total <= 0:
        total = known + other + available

    # Guard: if known+other > used (rounding/FS mismatch), clamp other
    if known + other > used:
        other = max(used - known, 0)

    app_usage = back + ollama + mysql + files

    blocks = {
        "Cache": back,
        "Ollama": ollama,
        "DataBase": mysql,
        "Files": files,
        "Other": other,
    }

    colors = {
        "Cache": "#6A5ACD",
        "Ollama": "#20B2AA",
        "DataBase": "#FF8C00",
        "Files": "#DC143C",
        "Other": "#C7B75C",
        "_free": "#E0E0E0",  # available (gray)
    }

    return bar_widget(
        blocks,
        colors=colors,
        title="Disk Usage",
        total=total,
        available=available,
        show_legend=True,
        caption_html="Total: "
        + fmt_bytes(total)
        + ", Used: "
        + fmt_bytes(used)
        + ", App usage: "
        + fmt_bytes(app_usage),
        value_formatter=fmt_bytes,
        show_percent=True,
    )


def bar_widget(
    blocks,  # dict{name->value} or list[(name, value)]
    colors: dict
    | None = None,  # dict{name->css color}; falls back to generate_color(name)
    title: str | None = None,  # optional title for the bar
    total: int | float | None = None,
    available: int | float = 0,  # optional trailing segment (e.g., free space)
    # The width_px parameter is no longer needed for a responsive design
    height_px: int = 18,
    show_legend: bool = True,
    caption_html: str | None = None,
    value_formatter=None,  # callable(value)->str; if None uses str(value)
    show_percent: bool = True,
) -> str:
    # This is a placeholder for a color generation function.
    # You'll need to define this function or import it from a library.
    def generate_color(name):
        import hashlib

        hex_code = hashlib.sha256(name.encode()).hexdigest()[:6]
        return f"#{hex_code}"

    cid = f"bar-{uuid.uuid4().hex}"

    # normalize input
    items = list(blocks.items()) if isinstance(blocks, dict) else list(blocks)
    valfmt = value_formatter or (lambda v: str(v))

    # infer total if not provided
    s = sum(max(0, float(v)) for _, v in items)
    total = float(total) if total is not None else (s + max(0, float(available)))
    total = max(total, 1.0)  # avoid div/0
    available = max(0.0, float(available))

    def color_for(name: str) -> str:
        if colors and name in colors:
            return colors[name]
        return generate_color(name)

    # segments + legend
    segs_html, legend_html = [], []
    for name, val in items:
        v = max(0.0, float(val))
        pct = v / total * 100.0
        if pct <= 0:
            continue
        col = color_for(name)
        segs_html.append(
            f'<div class="seg" data-name="{name}" data-value="{v}" '
            f'style="width:{pct:.6f}%;background:{col};height:100%"></div>'
        )
        if show_legend:
            legend_html.append(
                f'<span style="display:inline-flex;align-items:center;gap:6px;margin-right:12px">'
                f'<span style="width:10px;height:10px;background:{col};display:inline-block;border-radius:2px"></span>'
                f'<span style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px">{name}: {valfmt(v)}'
                f'{" ("+str(round(pct,1))+"%)" if show_percent else ""}</span></span>'
            )

    # optional trailing segment (e.g., Available)
    if available > 0:
        name = "Available"
        col = colors.get(name, "#E0E0E0") if colors else "#E0E0E0"
        pct = available / total * 100.0
        segs_html.append(
            f'<div class="seg" data-name="{name}" data-value="{available}" '
            f'style="width:{pct:.6f}%;background:{col};height:100%"></div>'
        )
        if show_legend:
            legend_html.append(
                f'<span style="display:inline-flex;align-items:center;gap:6px;margin-right:12px">'
                f'<span style="width:10px;height:10px;background:{col};display:inline-block;border-radius:2px"></span>'
                f'<span style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px">{name}: {valfmt(available)}'
                f'{" ("+str(round(pct,1))+"%)" if show_percent else ""}</span></span>'
            )

    legend = (
        f'<div style="margin-top:6px">{"".join(legend_html)}</div>'
        if show_legend
        else ""
    )

    st.markdown(
        f"""
<div id="{cid}" style="position:relative;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Helvetica,Arial,sans-serif;">
  {f"<div style='font-size:20px;font-weight:500;margin-bottom:4px;'>{title}</div>" if title else ""}
  <div style="width:100%;border:1px solid #ddd;border-radius:6px;overflow:hidden;background:#f7f7f7;">
    <div class="bar" style="display:flex;width:100%;height:{height_px}px;">
      {''.join(segs_html) if segs_html else '<div style="width:100%;height:100%;background:#eee"></div>'}
    </div>
  </div>
  {legend}
  <div style="margin:4px;font-size:13px;color:#444">{caption_html if caption_html else ''}</div>

  <div class="tooltip" style="position:absolute;pointer-events:none;padding:6px 8px;background:#111;color:#fff;border-radius:6px;font-size:12px;opacity:0;transform:translate(-50%,-140%);transition:opacity .08s;white-space:nowrap;z-index:10;"></div>

  <script>
  (function() {{
    const root = document.getElementById("{cid}");
    const tip  = root.querySelector(".tooltip");
    root.querySelectorAll(".seg").forEach(seg => {{
      seg.addEventListener("mousemove",(e)=>{{
        const name  = seg.dataset.name;
        const value = seg.dataset.value;
        tip.textContent = name + " • " + value;
        const r = root.getBoundingClientRect();
        tip.style.left = (e.clientX - r.left) + "px";
        tip.style.top  = (e.clientY - r.top) + "px";
        tip.style.opacity = "1";
      }});
      seg.addEventListener("mouseleave",()=> tip.style.opacity="0");
    }});
  }})();
  </script>
</div>
""".strip(),
        unsafe_allow_html=True,
    )
