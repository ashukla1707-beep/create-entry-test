
import json, re, hashlib, time
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

PRODUCTS = [
    ("TK","The Breakup Trial Kit","https://sosorrysugar.com/products/the-breakup-trial-kit"),
    ("SSC","Sea Salt Caramel","https://sosorrysugar.com/products/sea-salt-caramel"),
    ("FVC","French Vanilla Cloud","https://sosorrysugar.com/products/french-vanilla-cloud"),
    ("SCM","Silk Chocolate Mocha","https://sosorrysugar.com/products/silk-chocolate-mocha"),
    ("HAL","Hazel Almond Latte","https://sosorrysugar.com/products/hazel-almond-latte"),
    ("BGT","Butter Gooey Toffee","https://sosorrysugar.com/products/butter-gooey-toffee"),
]
OUT = Path("scrape_output")
OUT.mkdir(exist_ok=True)

def txt(loc):
    try:
        if loc.count() == 0: return None
        s = loc.first.inner_text(timeout=1500)
        return re.sub(r"\s+"," ",s).strip() or None
    except: return None

def attr(loc, name):
    try:
        if loc.count() == 0: return None
        v=loc.first.get_attribute(name, timeout=1500)
        return re.sub(r"\s+"," ",v).strip() if v else None
    except: return None

def rating_from(card):
    loc=card.locator(".jdgm-rev__rating,[data-score],[aria-label*='star' i],[title*='star' i]")
    for a in ("data-score","aria-label","title"):
        v=attr(loc,a)
        if v:
            m=re.search(r"([1-5](?:\.\d+)?)",v)
            if m: return int(round(float(m.group(1))))
    t=txt(loc)
    if t:
        m=re.search(r"([1-5](?:\.\d+)?)",t)
        if m: return int(round(float(m.group(1))))
    # fallback: count star icons if present
    try:
        n=card.locator(".jdgm-star.jdgm--on,.jdgm-star[aria-label*='1 star' i]").count()
        if 1 <= n <= 5: return n
    except: pass
    return None

def displayed_count(page):
    for sel in [".jdgm-prev-badge__text",".jdgm-rev-widg__summary-text","body"]:
        try:
            s=txt(page.locator(sel))
            if not s: continue
            vals=[int(x.replace(",","")) for x in re.findall(r"(\d[\d,]*)\s+reviews?\b",s,re.I)]
            if vals: return max(vals)
        except: pass
    return None

def extract(page, code, product, url):
    cards=page.locator("#judgeme_product_reviews .jdgm-rev")
    if cards.count()==0: cards=page.locator(".jdgm-review-widget .jdgm-rev")
    rows=[]
    for i in range(cards.count()):
        c=cards.nth(i)
        rid=attr(c,"data-review-id") or attr(c,"data-id") or attr(c,"id")
        reviewer=txt(c.locator(".jdgm-rev__author,.jdgm-rev__author-wrapper,[class*='author']"))
        title=txt(c.locator(".jdgm-rev__title,[class*='review-title']"))
        body=txt(c.locator(".jdgm-rev__body,[class*='review-body']"))
        date=txt(c.locator(".jdgm-rev__timestamp,time,[class*='timestamp'],[class*='date']"))
        rating=rating_from(c)
        verified=c.locator(".jdgm-rev__buyer-badge,[class*='verified'],[title*='verified' i]").count()>0
        if not any([reviewer,title,body,rating]): continue
        key=(rid or "")+"|"+(reviewer or "")+"|"+(date or "")+"|"+str(rating or "")+"|"+(body or "")
        fp=hashlib.sha256(key.encode("utf-8","ignore")).hexdigest()
        rows.append({
            "product_code":code,"product":product,"source_url":url,
            "source_review_id":rid,"reviewer_name":reviewer,"verified_buyer":verified,
            "rating":rating,"review_date_raw":date,"review_title":title,"review_text":body,
            "fingerprint":fp
        })
    return rows

def click_more(page):
    sels=[
      "#judgeme_product_reviews button:has-text('Load more')",
      "#judgeme_product_reviews a:has-text('Load more')",
      "#judgeme_product_reviews button:has-text('Show more')",
      "#judgeme_product_reviews a:has-text('Show more')",
      "#judgeme_product_reviews .jdgm-paginate__next-page",
      "#judgeme_product_reviews a[aria-label='Next']",
      "#judgeme_product_reviews button[aria-label='Next']",
      "#judgeme_product_reviews a[rel='next']",
      "#judgeme_product_reviews a:has-text('Next')",
      "#judgeme_product_reviews button:has-text('Next')",
    ]
    for sel in sels:
        try:
            ls=page.locator(sel)
            for i in range(ls.count()):
                el=ls.nth(i)
                if not el.is_visible(): continue
                cls=(el.get_attribute("class") or "").lower()
                if el.get_attribute("disabled") is not None or el.get_attribute("aria-disabled")=="true" or "disabled" in cls:
                    continue
                before=page.locator("#judgeme_product_reviews").inner_text(timeout=3000)
                el.scroll_into_view_if_needed()
                el.click(timeout=5000)
                page.wait_for_timeout(1200)
                try: page.wait_for_load_state("networkidle",timeout=5000)
                except: pass
                after=page.locator("#judgeme_product_reviews").inner_text(timeout=3000)
                if after != before: return True
        except: pass
    # numbered pagination fallback: click the next page number after current
    try:
        cur=page.locator("#judgeme_product_reviews .jdgm-paginate__page.jdgm-curt")
        if cur.count():
            cur_text=txt(cur)
            if cur_text and cur_text.isdigit():
                nxt=str(int(cur_text)+1)
                loc=page.locator(f"#judgeme_product_reviews .jdgm-paginate__page:text-is('{nxt}')")
                if loc.count() and loc.first.is_visible():
                    loc.first.click(); page.wait_for_timeout(1200); return True
    except: pass
    return False

all_rows=[]; logs=[]; network_urls=[]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    ctx=browser.new_context(user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36",locale="en-IN")
    page=ctx.new_page()
    page.set_default_timeout(45000)
    def on_response(resp):
        u=resp.url
        if "judge.me" in u.lower() or "judgeme" in u.lower():
            if u not in network_urls: network_urls.append(u)
    page.on("response",on_response)
    for code,product,url in PRODUCTS:
        seen={}
        try:
            page.goto(url,wait_until="domcontentloaded",timeout=60000)
            page.wait_for_timeout(5000)
            try:
                page.locator("#judgeme_product_reviews").scroll_into_view_if_needed(timeout=5000)
                page.wait_for_timeout(2500)
            except: pass
            expected=displayed_count(page)
            for step in range(1,80):
                batch=extract(page,code,product,url)
                for r in batch: seen.setdefault(r["fingerprint"],r)
                if expected and len(seen)>=expected: break
                if not click_more(page): break
            rows=list(seen.values())
            all_rows.extend(rows)
            logs.append({"product_code":code,"product":product,"url":url,"displayed_review_count":expected,"scraped_reviews":len(rows),"match":(expected==len(rows) if expected is not None else None)})
        except Exception as e:
            logs.append({"product_code":code,"product":product,"url":url,"displayed_review_count":None,"scraped_reviews":0,"match":False,"error":repr(e)})
        time.sleep(1)
    ctx.close(); browser.close()

# assign raw sequential IDs; final de-dup happens later
for i,r in enumerate(all_rows,1): r["raw_id"]=f"RAW{i:04d}"
(OUT/"reviews.json").write_text(json.dumps(all_rows,ensure_ascii=False,indent=2),encoding="utf-8")
(OUT/"log.json").write_text(json.dumps(logs,ensure_ascii=False,indent=2),encoding="utf-8")
(OUT/"network_urls.json").write_text(json.dumps(network_urls,ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps(logs,indent=2))
