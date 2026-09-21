#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AdPulce Agency — dashboardni Facebook (Meta) Marketing API'dan avtomatik yangilash.

Ishlatish:
    python3 update_dashboard.py

Nima qiladi:
  1. .env faylidan token/app ma'lumotlarini o'qiydi
  2. Tokenni "uzoq muddatli" (60 kunlik) tokenga almashtiradi va .env'ga qaytarib yozadi
  3. Har bir mijozning reklama kabinet(lar)idan bugungi/haftalik xarajat, lidlar, CTR, CPM,
     eng faol kampaniyalar va joriy balansni oladi
  4. index.html faylining ICHIDAGI faqat DATA bloklarini yangilaydi (dizayn/kod o'zgarmaydi)

Xavfsizlik: token va app secret HECH QACHON index.html ichiga yozilmaydi, faqat .env faylida turadi.
"""
import json
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Asia/Tashkent DST qilmaydi, shuning uchun doimiy UTC+5 offset yetarli
# (zoneinfo/tzdata cloud muhitida mavjud bo'lmasligi mumkin).
TASHKENT_TZ = timezone(timedelta(hours=5))

BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / ".env"
HTML_PATH = BASE_DIR / "index.html"
SITE_HTML_PATH = BASE_DIR / "api" / "dashboard.html"  # Vercel shu faylni ko'rsatadi
HISTORY_PATH = BASE_DIR / "history.json"
API_VERSION = "v21.0"

# ---------------------------------------------------------------------------
# Mijozlar -> reklama kabinet(lar)i xaritasi.
# Bir mijozda bir nechta kabinet bo'lsa (masalan Intouch), ro'yxatga bir nechta
# act_... ID qo'shiladi va ular yig'indi (summa) qilinadi.
# Yangi mijoz qo'shilsa yoki kabinet ID o'zgarsa, shu yerni tahrirlang.
# ---------------------------------------------------------------------------
CLIENTS_CONFIG = [
    {"key": "adpulce",    "name": "AdPulce",            "kpi": 5,    "accounts": ["act_1917933155489560"]},
    {"key": "access",     "name": "Access",             "kpi": 2,    "accounts": ["act_1242499587861857"]},
    {"key": "booking",    "name": "Booking",            "kpi": 1.5,    "accounts": ["act_1637870214201055"]},
    {"key": "intouch",    "name": "Intouch",            "kpi": 4,    "accounts": ["act_7372692399429664", "act_1434361421045010"]},
    {"key": "mastermock", "name": "Master Mock",        "kpi": 1, "accounts": ["act_1820788456001171"]},
    {"key": "maydon",     "name": "Maydon Ta'lim",      "kpi": 2,    "accounts": ["act_2161468034191195"]},
    {"key": "mercury",    "name": "Mercury Vec Consulting", "kpi": 0.5, "accounts": ["act_777971871341543"]},
    {"key": "sayyohvisa", "name": "Sayyoh VISA",        "kpi": 1,    "accounts": ["act_1263636038863945"]},
    {"key": "superkit",   "name": "Super Kitobxon",     "kpi": 2,    "accounts": ["act_584751316698691"]},
    {"key": "sweetkids",  "name": "Sweet Kids",         "kpi": 2,  "accounts": ["act_824386570538579"]},
    {"key": "zimzimuz",   "name": "Zim Zim Uzbekiston", "kpi": 3,    "accounts": ["act_901347765351013"]},
    {"key": "zimzimtr",   "name": "Zim Zim Turkiya",    "kpi": 5,    "accounts": ["act_1558878449074756"]},
    {"key": "madaniy",    "name": "Madaniy",            "kpi": 3,    "accounts": ["act_1102057662332741"]},
    {"key": "azizbek",    "name": "Azizbek Dubayyo",    "kpi": 3,    "accounts": ["act_1076450191513140"]},
    {"key": "sweetkids2", "name": "Sweet Kids (2-akkaunt)", "kpi": 3, "accounts": ["act_576151608099653"]},
]

# Qaysi mijozlarning "chegara" (threshold) qiymati haqiqiy skrinshotdan tasdiqlangan.
# Boshqalar uchun bu qiymat noma'lum bo'lgani uchun dashboard foiz-chiziqni ko'rsatmaydi.
THRESHOLD_KNOWN = {"booking", "intouch"}

LEAD_ACTION_PRIORITY = [
    "onsite_conversion.lead_grouped",
    "lead",
    "offsite_conversion.fb_pixel_lead",
    "leadgen.other",
]


# ---------------------------------------------------------------------------
# .env bilan ishlash
# ---------------------------------------------------------------------------
def load_env():
    env = {}
    if not ENV_PATH.exists():
        sys.exit(".env fayli topilmadi. Avval token sozlashni bajaring.")
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def save_env(env):
    lines = [f"{k}={v}" for k, v in env.items()]
    ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# Tarix (kunlik solishtirish uchun) — history.json
# ---------------------------------------------------------------------------
def load_history():
    if HISTORY_PATH.exists():
        try:
            return json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {"days": {}}
    return {"days": {}}


def _guard_transient_zeros(history):
    """Kun ichida sarf kamaymaydi. MCP vaqtinchalik xato qilib ba'zi mijozni 0 qaytarsa
    (masalan Booking 13:12 da), oldingi soatdagi qiymatni saqlab qolamiz."""
    if not HISTORY_PATH.exists():
        return
    try:
        old = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return
    for section in ("days", "campaigns"):
        for day, by_key in (old.get(section) or {}).items():
            new_day = (history.get(section) or {}).get(day)
            if new_day is None:
                continue
            for key, old_val in by_key.items():
                if section == "days":
                    was = float((old_val or {}).get("spend") or 0)
                    now = float((new_day.get(key) or {}).get("spend") or 0)
                else:
                    was = sum(float(c.get("spend") or 0) for c in (old_val or []))
                    now = sum(float(c.get("spend") or 0) for c in (new_day.get(key) or []))
                if was > 0 and now == 0:
                    new_day[key] = old_val


def save_history(history):
    _guard_transient_zeros(history)
    HISTORY_PATH.write_text(json.dumps(history, indent=2, ensure_ascii=False), encoding="utf-8")


def get_previous_day_values(history, today_key, client_key):
    """Bugundan oldingi eng so'nggi kun yozuvidan shu mijozning spend/leads qiymatini qaytaradi."""
    days = history.get("days", {})
    prev_keys = sorted([d for d in days.keys() if d < today_key], reverse=True)
    for pk in prev_keys:
        entry = days[pk].get(client_key)
        if entry:
            return entry
    return None


# ---------------------------------------------------------------------------
# Graph API yordamchilari
# ---------------------------------------------------------------------------
def api_get(path, params, token):
    params = dict(params)
    params["access_token"] = token
    url = f"https://graph.facebook.com/{API_VERSION}/{path}?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        raise RuntimeError(f"Facebook API xatosi ({path}): {body}") from e


def exchange_long_lived_token(env):
    print("Tokenni uzoq muddatlisiga almashtiryapman...")
    params = {
        "grant_type": "fb_exchange_token",
        "client_id": env["FB_APP_ID"],
        "client_secret": env["FB_APP_SECRET"],
        "fb_exchange_token": env["FB_USER_TOKEN"],
    }
    url = f"https://graph.facebook.com/{API_VERSION}/oauth/access_token?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=30) as resp:
        data = json.loads(resp.read().decode())
    new_token = data["access_token"]
    expires_in = data.get("expires_in", 0)
    env["FB_USER_TOKEN"] = new_token
    env["FB_TOKEN_EXPIRES_HINT_DAYS"] = str(round(expires_in / 86400, 1)) if expires_in else "noma'lum"
    save_env(env)
    print(f"  -> Yangi token saqlandi (~{env['FB_TOKEN_EXPIRES_HINT_DAYS']} kun amal qiladi).")
    return new_token


def get_leads(actions):
    if not actions:
        return 0
    for p in LEAD_ACTION_PRIORITY:
        for a in actions:
            if a.get("action_type") == p:
                try:
                    return int(float(a["value"]))
                except (ValueError, TypeError):
                    return 0
    return 0


def get_clicks(actions):
    if not actions:
        return 0
    for a in actions:
        if a.get("action_type") == "link_click":
            try:
                return int(float(a["value"]))
            except (ValueError, TypeError):
                return 0
    return 0


def fetch_period(accounts, date_preset, token):
    """Bir nechta kabinetni yig'indi (sum) qilib, bitta davr uchun natija qaytaradi."""
    total_spend = 0.0
    total_leads = 0
    total_impr = 0
    total_clicks = 0
    for acc in accounts:
        r = api_get(f"{acc}/insights", {
            "date_preset": date_preset,
            "fields": "spend,actions,impressions",
        }, token)
        rows = r.get("data", [])
        for row in rows:
            total_spend += float(row.get("spend", 0) or 0)
            total_impr += int(row.get("impressions", 0) or 0)
            total_leads += get_leads(row.get("actions"))
            total_clicks += get_clicks(row.get("actions"))
    cpm = (total_spend / total_impr * 1000) if total_impr else 0
    ctr = (total_clicks / total_impr * 100) if total_impr else 0
    return {"spend": round(total_spend, 2), "leads": total_leads, "cpm": round(cpm, 2), "ctr": round(ctr, 2)}


def fetch_campaigns(accounts, token, top_n=6, date_preset="today"):
    items = []
    total_count = 0
    for acc in accounts:
        r = api_get(f"{acc}/insights", {
            "date_preset": date_preset,
            "level": "campaign",
            "fields": "campaign_id,campaign_name,spend,actions,impressions,reach",
            "filtering": json.dumps([{"field": "spend", "operator": "GREATER_THAN", "value": 0}]),
            "limit": 100,
        }, token)
        rows = r.get("data", [])
        total_count += len(rows)
        budgets = {}
        try:
            camp_r = api_get(f"{acc}/campaigns", {"fields": "name,daily_budget", "limit": 200}, token)
            for c in camp_r.get("data", []):
                if c.get("daily_budget"):
                    budgets[c["id"]] = round(int(c["daily_budget"]) / 100, 2)
        except RuntimeError:
            pass
        for row in rows:
            spend = float(row.get("spend", 0) or 0)
            leads = get_leads(row.get("actions"))
            items.append({
                "name": row.get("campaign_name", "—"),
                "spend": round(spend, 2),
                "leads": leads,
                "impressions": int(row.get("impressions", 0) or 0),
                "reach": int(row.get("reach", 0) or 0),
                "budget": budgets.get(row.get("campaign_id"), 0),
            })
    items.sort(key=lambda x: x["spend"], reverse=True)
    shown = items[:top_n]
    inactive_note = None
    hidden_count = len(items) - len(shown)
    if hidden_count > 0:
        inactive_note = f"Bundan tashqari yana {hidden_count} ta kampaniya (kam xarajatli/faol) ko'rsatilmadi."
    return shown, inactive_note


def fetch_balance(accounts, token):
    total = 0.0
    for acc in accounts:
        r = api_get(acc, {"fields": "balance,currency"}, token)
        try:
            total += float(r.get("balance", 0) or 0) / 100
        except (ValueError, TypeError):
            pass
    return round(total, 2)


# ---------------------------------------------------------------------------
# JS matn generatorlari
# ---------------------------------------------------------------------------
def js_str(s):
    if "'" in s and '"' not in s:
        return f'"{s}"'
    return "'" + s.replace("'", "\\'") + "'"


def render_history_js(history, keep_days=30):
    days = history.get("days", {})
    keys = sorted(days.keys(), reverse=True)[:keep_days]
    lines = ["const HISTORY = {"]
    for k in keys:
        entries = days[k]
        parts = []
        for client_key, v in entries.items():
            parts.append("%s:{spend:%s, leads:%s}" % (js_str(client_key), v["spend"], v["leads"]))
        lines.append(f"  {js_str(k)}: {{" + ", ".join(parts) + "},")
    lines.append("};")
    return "\n".join(lines)


def render_campaign_history_js(history, keep_days=30):
    days = history.get("campaigns", {})
    keys = sorted(days.keys(), reverse=True)[:keep_days]
    lines = ["const CAMPAIGN_HISTORY = {"]
    for k in keys:
        lines.append(f"  {js_str(k)}: {{")
        for client_key, items in days[k].items():
            item_strs = []
            for it in items:
                item_strs.append(
                    "{name:%s, spend:%s, leads:%s, impressions:%s, reach:%s, budget:%s}" % (
                        js_str(it["name"]), it["spend"], it["leads"], it["impressions"], it["reach"], it["budget"]
                    )
                )
            lines.append(f"    {js_str(client_key)}: [" + ", ".join(item_strs) + "],")
        lines.append("  },")
    lines.append("};")
    return "\n".join(lines)


def render_budget_history_js(history, keep_days=30):
    days = history.get("budget", {})
    keys = sorted(days.keys(), reverse=True)[:keep_days]
    lines = ["const BUDGET_HISTORY = {"]
    for k in keys:
        parts = []
        for client_key, v in days[k].items():
            parts.append("%s:{balance:%s}" % (js_str(client_key), v["balance"]))
        lines.append(f"  {js_str(k)}: {{" + ", ".join(parts) + "},")
    lines.append("};")
    return "\n".join(lines)


def render_clients_js(rows):
    lines = ["const CLIENTS = ["]
    for c in rows:
        kpi_js = "null" if c["kpi"] is None else c["kpi"]
        prev = c.get("prev")
        prev_js = "null" if not prev else "{spend:%s, leads:%s}" % (prev["spend"], prev["leads"])
        lines.append(
            "  {key:%s, name:%s, kpi:%s, today:{spend:%s, leads:%s}, week:{spend:%s, leads:%s}, "
            "ctr:%s, cpm:%s, source:%s, prev:%s}," % (
                js_str(c["key"]), js_str(c["name"]), kpi_js,
                c["today"]["spend"], c["today"]["leads"],
                c["week"]["spend"], c["week"]["leads"],
                c["ctr"], c["cpm"], js_str(c["source"]), prev_js,
            )
        )
    lines.append("];")
    return "\n".join(lines)


def render_campaigns_js(campaigns_by_key, meta_by_key):
    lines = ["const CAMPAIGNS = {"]
    for key, items in campaigns_by_key.items():
        meta = meta_by_key[key]
        lines.append(f"  {key}: {{")
        lines.append(f"    source: {js_str(meta['source'])},")
        lines.append(f"    sourceLabel: {js_str(meta['sourceLabel'])},")
        lines.append("    items: [")
        for it in items:
            lines.append(
                "      {name:%s, spend:%s, leads:%s, impressions:%s, reach:%s, budget:%s}," % (
                    js_str(it["name"]), it["spend"], it["leads"], it["impressions"], it["reach"], it["budget"]
                )
            )
        lines.append("    ],")
        if meta.get("extra"):
            lines.append(f"    extra: {js_str(meta['extra'])},")
        lines.append("  },")
    lines.append("};")
    return "\n".join(lines)


def render_budget_js(rows):
    lines = ["const BUDGET = ["]
    for b in rows:
        lines.append(
            "  {key:%s, name:%s, source:%s, balance:%s, threshold:%s, payDate:%s, dailyLimit:%s, thresholdKnown:%s}," % (
                js_str(b["key"]), js_str(b["name"]), js_str(b["source"]),
                b["balance"], b["threshold"], js_str(b["payDate"]), b["dailyLimit"],
                "true" if b["key"] in THRESHOLD_KNOWN else "false",
            )
        )
    lines.append("];")
    return "\n".join(lines)


def replace_block(html, marker, new_js):
    start = f"/* @DATA:{marker}_START */"
    end = f"/* @DATA:{marker}_END */"
    pattern = re.compile(re.escape(start) + r".*?" + re.escape(end), re.DOTALL)
    replacement = f"{start}\n{new_js}\n{end}"
    new_html, count = pattern.subn(replacement, html, count=1)
    if count == 0:
        raise RuntimeError(f"index.html ichida {marker} bloki topilmadi — fayl tuzilishi o'zgargan bo'lishi mumkin.")
    return new_html


def parse_existing_budget_extras(html):
    """Mavjud BUDGET blokidan threshold/payDate/dailyLimit qiymatlarini o'qib qaytaradi
    (bu qiymatlar API'dan olinmaydi, shuning uchun avvalgi holatini saqlab qolamiz)."""
    m = re.search(r"/\* @DATA:BUDGET_START \*/(.*?)/\* @DATA:BUDGET_END \*/", html, re.DOTALL)
    if not m:
        return {}
    block = m.group(1)
    result = {}
    row_re = re.compile(
        r"key:'([^']+)'.*?threshold:([\d.]+).*?payDate:'([^']*)'.*?dailyLimit:([\d.]+)"
    )
    for row in row_re.finditer(block):
        key, threshold, pay_date, daily_limit = row.groups()
        result[key] = {"threshold": float(threshold), "payDate": pay_date, "dailyLimit": float(daily_limit)}
    return result


# ---------------------------------------------------------------------------
# Asosiy oqim
# ---------------------------------------------------------------------------
def main():
    env = load_env()
    if not env.get("FB_APP_ID") or not env.get("FB_APP_SECRET") or not env.get("FB_USER_TOKEN"):
        sys.exit("'.env' faylida FB_APP_ID / FB_APP_SECRET / FB_USER_TOKEN to'liq emas.")

    token = exchange_long_lived_token(env)

    html = HTML_PATH.read_text(encoding="utf-8")
    existing_budget_extras = parse_existing_budget_extras(html)

    client_rows = []
    campaigns_by_key = {}
    campaigns_meta = {}
    budget_rows = []

    now = datetime.now(TASHKENT_TZ)
    today_str = now.strftime("%d-%m-%Y %H:%M")
    today_key = now.strftime("%Y-%m-%d")
    history = load_history()
    history["days"].setdefault(today_key, {})

    for cfg in CLIENTS_CONFIG:
        key, name, kpi, accounts = cfg["key"], cfg["name"], cfg["kpi"], cfg["accounts"]
        print(f"-> {name} ({', '.join(accounts)}) yuklanmoqda...")
        try:
            today = fetch_period(accounts, "today", token)
            week = fetch_period(accounts, "this_week_mon_today", token)
            source = "real"
        except RuntimeError as e:
            print(f"   XATOLIK: {e}\n   -> {name} eski (demo) qiymatlarda qoldiriladi.")
            today = {"spend": 0, "leads": 0, "cpm": 0, "ctr": 0}
            week = {"spend": 0, "leads": 0, "cpm": 0, "ctr": 0}
            source = "demo"

        prev = get_previous_day_values(history, today_key, key)
        history["days"][today_key][key] = {"spend": today["spend"], "leads": today["leads"]}

        client_rows.append({
            "key": key, "name": name, "kpi": kpi,
            "today": {"spend": today["spend"], "leads": today["leads"]},
            "week": {"spend": week["spend"], "leads": week["leads"]},
            "ctr": today["ctr"], "cpm": today["cpm"],
            "source": source, "prev": prev,
        })

        try:
            camp_items, inactive_note = fetch_campaigns(accounts, token)
            campaigns_by_key[key] = camp_items
            campaigns_meta[key] = {
                "source": "real",
                "sourceLabel": f"Manba: Facebook Marketing API, avtomatik yangilandi ({today_str})",
                "extra": inactive_note,
            }
            history.setdefault("campaigns", {}).setdefault(today_key, {})[key] = camp_items
        except RuntimeError as e:
            print(f"   Kampaniyalarni olishda xatolik: {e}")
            campaigns_by_key[key] = []
            campaigns_meta[key] = {"source": "demo", "sourceLabel": "Xatolik tufayli yangilanmadi.", "extra": None}

        try:
            balance = fetch_balance(accounts, token)
            extras = existing_budget_extras.get(key, {"threshold": balance * 1.3 if balance else 50, "payDate": "noma'lum", "dailyLimit": 0})
            budget_rows.append({
                "key": key, "name": name, "source": "real",
                "balance": balance,
                "threshold": extras["threshold"], "payDate": extras["payDate"], "dailyLimit": extras["dailyLimit"],
            })
            history.setdefault("budget", {}).setdefault(today_key, {})[key] = {"balance": balance}
        except RuntimeError as e:
            print(f"   Balansni olishda xatolik: {e}")
            extras = existing_budget_extras.get(key, {"threshold": 50, "payDate": "noma'lum", "dailyLimit": 0})
            budget_rows.append({
                "key": key, "name": name, "source": "demo",
                "balance": 0, "threshold": extras["threshold"], "payDate": extras["payDate"], "dailyLimit": extras["dailyLimit"],
            })

    html = replace_block(html, "META", f"const DATA_META = {{ updatedAt: {js_str(today_str)}, todayKey: {js_str(today_key)} }};")
    html = replace_block(html, "HISTORY", render_history_js(history))
    html = replace_block(html, "CAMPAIGN_HISTORY", render_campaign_history_js(history))
    html = replace_block(html, "BUDGET_HISTORY", render_budget_history_js(history))
    html = replace_block(html, "CLIENTS", render_clients_js(client_rows))
    html = replace_block(html, "CAMPAIGNS", render_campaigns_js(campaigns_by_key, campaigns_meta))
    html = replace_block(html, "BUDGET", render_budget_js(budget_rows))

    HTML_PATH.write_text(html, encoding="utf-8")
    SITE_HTML_PATH.parent.mkdir(exist_ok=True)
    SITE_HTML_PATH.write_text(html, encoding="utf-8")

    # Tarixni 60 kundan ortiq saqlamaymiz (fayl shishib ketmasin)
    for section in ("days", "campaigns", "budget"):
        bucket = history.get(section, {})
        old_keys = sorted(bucket.keys(), reverse=True)[60:]
        for old_day in old_keys:
            del bucket[old_day]
    save_history(history)

    print(f"\nTayyor! index.html yangilandi ({today_str}). Brauzerda F5 bosing.")

    sync_to_github(today_str)


def sync_to_github(today_str):
    """Yangilangan saytni GitHub'ga yuboradi (Vercel shundan o'zi qayta joylashtiradi)."""
    def run(args):
        return subprocess.run(args, cwd=BASE_DIR, capture_output=True, text=True)

    remote = run(["git", "remote"])
    if "origin" not in remote.stdout:
        print("\n(GitHub ulanmagan — sayt hali faqat lokal. 'origin' remote sozlanganda avtomatik yuboriladi.)")
        return

    run(["git", "add", "index.html", "api/dashboard.html", "history.json", "vercel.json", "api/gate.js", "update_dashboard.py"])
    commit = run(["git", "commit", "-m", f"Avtomatik yangilanish: {today_str}"])
    if commit.returncode != 0 and "nothing to commit" not in (commit.stdout + commit.stderr):
        print("GitHub'ga saqlashda xatolik (commit):", commit.stderr.strip())
        return

    push = run(["git", "push", "origin", "HEAD:main"])
    if push.returncode != 0:
        print("GitHub'ga yuborishda xatolik (push):", push.stderr.strip())
    else:
        print("GitHub'ga yuborildi — Vercel bir necha soniyada saytni yangilaydi.")


if __name__ == "__main__":
    main()
