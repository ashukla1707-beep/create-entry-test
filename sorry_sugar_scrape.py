import csv, hashlib, json, re, time
from datetime import datetime, timezone
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

def text_of(loc):
    try:
        if loc.count() == 0: return ""
        return re.sub(r"\\s+"," ",loc.first.inner_text(timeout=2000)).strip()
    except Exception:
        return ""

def attr(loc, name):
    try:
        if loc.count() == 0: return ""
        return (loc.first.get_attribute(name, timeout=2000) or "").strip()
    except Exception:
        return ""

def expected_count(page):
    root = page.locator("#judgeme_product_reviews")
    try:
        t = text_of(root.locator(".jm-average-rating-display"))
        m = re.search(r"(\\d[\\d,]*)\\s+reviews?", t, re.I)
        if m:
            return int(m.group(1).replace(",", ""))
    except Exception:
        pass
    try:
        t = text_of(root)
        m = re.search(r"Customer Reviews.*?(\\d[\\d,]*)\\s+reviews?", t, re.I | re.S)
        if m:
            return int(m.group(1).replace(",", ""))
        if re.search(r"\\bNo reviews\\b|Be the first one to review", t, re.I):
            return 0
    except Exception:
        pass
    return None

def rating_of(card):
    loc = card.locator(".jdgm-rev__rating,[data-score],[aria-label*='star' i],[title*='star' i]")
    for a in ("data-score","aria-label","title"):
        v = attr(loc,a)
        m = re.search(r"([1-5](?:\\.\\d+)?)",v)
        if m: return int(round(float(m.group(1))))
    m = re.search(r"([1-5](?:\\.\\d+)?)", text_of(loc))
    return int(round(float(m.group(1)))) if m else None

def extract(page, code, product, url):
    cards = page.locator("#judgeme_product_reviews .jdgm-review-card")
    rows=[]
    date_re = re.compile(r"^(?:\\d{1,2}[/-]){2}\\d{4}$")
    for i in range(cards.count()):
        c=cards.nth(i)
        sid=attr(c,"data-review-id") or attr(c,"data-id")
        reviewer=text_of(c.locator(".jdgm-review-card__name"))
        body=text_of(c.locator(".jdgm-review-card__body"))
        title=text_of(c.locator(".jdgm-review-card__title"))
        rating=rating_of(c)
        date=""
        try:
            ps=c.locator("p.jm-text")
            for j in range(ps.count()):
                t=text_of(ps.nth(j))
                if date_re.match(t):
                    date=t
                    break
        except Exception:
            pass
        verified = c.locator("[class*='verified' i], [aria-label*='verified' i], [title*='verified' i]").count() > 0
        if not any([sid,reviewer,title,body,date,rating]): continue
        fpbase = ("judgeme:"+sid) if sid else "|".join([reviewer,date,str(rating or ""),body])
        fp=hashlib.sha256(fpbase.encode("utf-8","ignore")).hexdigest()
        rows.append({
            "page_product_code":code,"page_product":product,"source_url":url,
            "source_review_id":sid,"reviewer_name":reviewer,"verified_buyer":verified,
            "rating":rating,"review_date_raw":date,"review_title":title,"review_text":body,
            "fingerprint":fp
        })
    return rows

def click_next(page):
    root = page.locator("#judgeme_product_reviews")
    before = root.locator(".jdgm-review-card").count()

    # First trigger any lazy/infinite loading by scrolling to the end of the widget.
    try:
        cards=root.locator(".jdgm-review-card")
        if cards.count():
            cards.last.scroll_into_view_if_needed()
        root.evaluate("(el) => el.scrollIntoView({block:'end'})")
        page.wait_for_timeout(1400)
        after=root.locator(".jdgm-review-card").count()
        if after > before:
            return True
    except Exception:
        pass

    # Modern Judge.me can use load-more, pagination, or a next control.
    try:
        candidates=root.locator("button, a")
        for i in range(candidates.count()):
            el=candidates.nth(i)
            try:
                if not el.is_visible():
                    continue
                # Ignore controls belonging to the write-review dialog/media carousel.
                if el.locator("xpath=ancestor::*[contains(@class,'jdgm-write-review-modal')]").count():
                    continue
                if el.locator("xpath=ancestor::*[contains(@class,'jm-media-grid')]").count():
                    continue
                txt=text_of(el).lower()
                aria=(attr(el,"aria-label") or "").lower()
                testid=(attr(el,"data-testid") or "").lower()
                cls=(attr(el,"class") or "").lower()
                signal=" ".join([txt,aria,testid,cls])
                if re.search(r"load.?more|show.?more|view.?more|more.?reviews|next.?page|pagination.?next|paginate.?next", signal):
                    el.scroll_into_view_if_needed()
                    el.click(timeout=5000)
                    page.wait_for_timeout(1400)
                    return True
            except Exception:
                continue
    except Exception:
        pass

    # Numbered pagination fallback: choose the next visible numeric page within
    # an element whose own/ancestor class suggests pagination.
    try:
        nums=root.locator("button, a")
        numeric=[]
        for i in range(nums.count()):
            el=nums.nth(i)
            try:
                if not el.is_visible(): continue
                t=text_of(el)
                if not t.isdigit(): continue
                context=(attr(el,"class") or "")+" "+(attr(el.locator("xpath=.."),"class") or "")
                if re.search(r"pag|page|nav", context, re.I):
                    numeric.append((int(t),el))
            except Exception:
                pass
        if numeric:
            current=1
            for n,el in numeric:
                a=(attr(el,"aria-current") or "").lower()
                cls=(attr(el,"class") or "").lower()
                if a=="page" or "current" in cls or "active" in cls:
                    current=n
            nxt=[x for x in numeric if x[0]>current]
            if nxt:
                nxt.sort(key=lambda z:z[0])
                nxt[0][1].click(timeout=5000)
                page.wait_for_timeout(1400)
                return True
    except Exception:
        pass
    return False

all_rows=[]
log=[]
stamp=datetime.now(timezone.utc).isoformat()
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    ctx=browser.new_context(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",locale="en-IN")
    page=ctx.new_page()
    network_urls=[]
    page.on("response", lambda r: network_urls.append(r.url) if ("judge" in r.url.lower() or "jdgm" in r.url.lower() or "review" in r.url.lower()) else None)
    page.set_default_timeout(45000)
    for code,product,url in PRODUCTS:
        print("SCRAPING",product,flush=True)
        err=""
        exp=None
        product_rows=[]
        try:
            network_urls.clear()
            page.goto(url+"#judgeme_product_reviews",wait_until="domcontentloaded",timeout=45000)
            page.wait_for_timeout(5000)
            if code == "TK":
                dbg = []
                dbg.append("FINAL_URL: "+page.url)
                dbg.append("TITLE: "+page.title())
                try: dbg.append("BODY_START:\n"+page.locator("body").inner_text(timeout=5000)[:8000])
                except Exception as e: dbg.append("BODY_ERROR: "+repr(e))
                dbg.append("\nNETWORK_URLS:\n"+"\n".join(network_urls[:300]))
                try:
                    inventory = page.evaluate("""() => {
                      const out=[];
                      for (const el of document.querySelectorAll('*')) {
                        const attrs=[...el.attributes].map(a=>a.name+'='+a.value).join(' ');
                        const cls=(el.getAttribute('class')||'');
                        const test=(attrs+' '+cls).toLowerCase();
                        if (test.includes('review') || test.includes('judge') || test.includes('jm-')) {
                          out.push(el.tagName+' | '+attrs+' | '+(el.innerText||'').trim().replace(/\\s+/g,' ').slice(0,300));
                          if (out.length>=500) break;
                        }
                      }
                      return out;
                    }""")
                    dbg.append("\nDOM_REVIEW_INVENTORY:\n"+"\n".join(inventory))
                except Exception as e:
                    dbg.append("\nDOM_INVENTORY_ERROR: "+repr(e))
                (OUT/"trial_debug.txt").write_text("\n".join(dbg),encoding="utf-8")
            exp=expected_count(page)
            seen={}
            for step in range(1,80):
                batch=extract(page,code,product,url)
                for r in batch:
                    seen.setdefault(r["fingerprint"],r)
                print(" step",step,"unique",len(seen),"expected",exp,flush=True)
                if exp is not None and len(seen)>=exp: break
                if not click_next(page): break
            product_rows=list(seen.values())
        except Exception as e:
            err=repr(e)
            print("ERROR",err,flush=True)
        all_rows.extend(product_rows)
        log.append({
            "product_code":code,"product":product,"url":url,
            "displayed_review_count":exp,"scraped_unique_reviews_on_page":len(product_rows),
            "count_matches_display": (len(product_rows)==exp) if exp is not None else "",
            "error":err,"scrape_timestamp_utc":stamp
        })
        time.sleep(1.5)
    ctx.close(); browser.close()

# Raw page appearances
fields=["page_product_code","page_product","source_url","source_review_id","reviewer_name","verified_buyer","rating","review_date_raw","review_title","review_text","fingerprint"]
with open(OUT/"sorry_sugar_raw_reviews.csv","w",newline="",encoding="utf-8-sig") as f:
    w=csv.DictWriter(f,fieldnames=fields); w.writeheader(); w.writerows(all_rows)

# Site-wide unique reviews + CR IDs
seen=set(); clean=[]
for r in all_rows:
    if r["fingerprint"] in seen: continue
    seen.add(r["fingerprint"])
    x=dict(r); x["Customer_Review_ID"]=f"CR{len(clean)+1:04d}"; clean.append(x)
clean_fields=["Customer_Review_ID"]+fields
with open(OUT/"sorry_sugar_clean_reviews.csv","w",newline="",encoding="utf-8-sig") as f:
    w=csv.DictWriter(f,fieldnames=clean_fields); w.writeheader(); w.writerows(clean)
with open(OUT/"sorry_sugar_scrape_log.csv","w",newline="",encoding="utf-8-sig") as f:
    w=csv.DictWriter(f,fieldnames=list(log[0].keys())); w.writeheader(); w.writerows(log)
with open(OUT/"summary.json","w",encoding="utf-8") as f:
    json.dump({"unique_reviews":len(clean),"raw_appearances":len(all_rows),"log":log},f,ensure_ascii=False,indent=2)
print("DONE unique",len(clean),"raw",len(all_rows),flush=True)
