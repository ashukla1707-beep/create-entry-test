
import json, re, hashlib, time
from pathlib import Path
import requests
from bs4 import BeautifulSoup

STORE = "sorrysugar-2.myshopify.com"
PRODUCTS = [
    ("TK","The Breakup Trial Kit",15014327550317,"https://sosorrysugar.com/products/the-breakup-trial-kit"),
    ("SSC","Sea Salt Caramel",15014327484781,"https://sosorrysugar.com/products/sea-salt-caramel"),
    ("FVC","French Vanilla Cloud",15014327386477,"https://sosorrysugar.com/products/french-vanilla-cloud"),
    ("SCM","Silk Chocolate Mocha",15014327517549,"https://sosorrysugar.com/products/silk-chocolate-mocha"),
    ("HAL","Hazel Almond Latte",15014327419245,"https://sosorrysugar.com/products/hazel-almond-latte"),
    ("BGT","Butter Gooey Toffee",15014327353709,"https://sosorrysugar.com/products/butter-gooey-toffee"),
]
OUT = Path("scrape_output")
OUT.mkdir(exist_ok=True)
ENDPOINT = "https://cdn.judge.me/reviews/reviews_for_widget"

session=requests.Session()
session.headers.update({"User-Agent":"Mozilla/5.0","Accept":"*/*","Referer":"https://sosorrysugar.com/"})

def norm(x):
    if x is None: return None
    s=re.sub(r"\s+"," ",str(x)).strip()
    return s or None

def rating_val(x):
    if x is None: return None
    m=re.search(r"([1-5](?:\.\d+)?)",str(x))
    return int(round(float(m.group(1)))) if m else None

def extract_dict_reviews(obj):
    """Recursively identify review-like dicts in JSON payloads."""
    found=[]
    def walk(x):
        if isinstance(x,dict):
            keys=set(x.keys())
            reviewish = (
                ("rating" in keys or "score" in keys) and
                ("body" in keys or "review_body" in keys or "content" in keys or "title" in keys) and
                ("id" in keys or "uuid" in keys or "reviewer" in keys or "reviewer_name" in keys)
            )
            if reviewish: found.append(x)
            for v in x.values(): walk(v)
        elif isinstance(x,list):
            for v in x: walk(v)
    walk(obj)
    # de-dup by id/repr
    out=[]; seen=set()
    for r in found:
        k=str(r.get("id") or r.get("uuid") or r.get("review_id") or json.dumps(r,sort_keys=True,default=str))
        if k not in seen:
            seen.add(k); out.append(r)
    return out

def from_dict(r, code, product, url):
    reviewer=r.get("reviewer_name") or r.get("name")
    rv=r.get("reviewer")
    if isinstance(rv,dict):
        reviewer=reviewer or rv.get("name") or rv.get("display_name")
    elif isinstance(rv,str):
        reviewer=reviewer or rv
    body=r.get("body") or r.get("review_body") or r.get("content") or r.get("text") or r.get("body_html")
    if body and "<" in str(body):
        body=BeautifulSoup(str(body),"html.parser").get_text(" ",strip=True)
    title=r.get("title") or r.get("review_title")
    date=r.get("created_at") or r.get("date") or r.get("submitted_at") or r.get("published_at")
    rid=r.get("id") or r.get("uuid") or r.get("review_id")
    rating=rating_val(r.get("rating") or r.get("score"))
    verified=bool(r.get("verified") or r.get("verified_buyer") or r.get("buyer_verified"))
    key="|".join(map(str,[rid or "",reviewer or "",date or "",rating or "",body or ""]))
    return {
        "product_code":code,"product":product,"source_url":url,"shopify_product_id":r.get("product_id"),
        "source_review_id":norm(rid),"reviewer_name":norm(reviewer),"verified_buyer":verified,
        "rating":rating,"review_date_raw":norm(date),"review_title":norm(title),"review_text":norm(body),
        "fingerprint":hashlib.sha256(key.encode("utf-8","ignore")).hexdigest()
    }

def parse_html(html, code, product, url):
    soup=BeautifulSoup(html,"html.parser")
    cards=soup.select(".jdgm-rev")
    rows=[]
    for c in cards:
        rid=c.get("data-review-id") or c.get("data-id") or c.get("id")
        a=c.select_one(".jdgm-rev__author, .jdgm-rev__author-wrapper, [class*='author']")
        t=c.select_one(".jdgm-rev__title, [class*='review-title']")
        b=c.select_one(".jdgm-rev__body, [class*='review-body']")
        d=c.select_one(".jdgm-rev__timestamp, time, [class*='timestamp'], [class*='date']")
        rat=c.select_one(".jdgm-rev__rating, [data-score], [aria-label*='star'], [title*='star']")
        rating=None
        if rat:
            rating=rating_val(rat.get("data-score") or rat.get("aria-label") or rat.get("title") or rat.get_text(" ",strip=True))
        reviewer=norm(a.get_text(" ",strip=True)) if a else None
        title=norm(t.get_text(" ",strip=True)) if t else None
        body=norm(b.get_text(" ",strip=True)) if b else None
        date=norm(d.get_text(" ",strip=True)) if d else None
        verified=bool(c.select_one(".jdgm-rev__buyer-badge, [class*='verified'], [title*='verified']"))
        if not any([reviewer,title,body,rating]): continue
        key="|".join(map(str,[rid or "",reviewer or "",date or "",rating or "",body or ""]))
        rows.append({
            "product_code":code,"product":product,"source_url":url,"shopify_product_id":None,
            "source_review_id":norm(rid),"reviewer_name":reviewer,"verified_buyer":verified,
            "rating":rating,"review_date_raw":date,"review_title":title,"review_text":body,
            "fingerprint":hashlib.sha256(key.encode("utf-8","ignore")).hexdigest()
        })
    return rows

all_rows=[]; logs=[]; probes={}
for code,product,pid,url in PRODUCTS:
    seen={}
    pages=0
    status_notes=[]
    expected=None
    for page in range(1,60):
        params={
            "product_id":pid,"page":page,"sort_by":"created_at","sort_dir":"desc",
            "skip_other_languages":"true","widget_theme":"cards",
            "shop_domain":STORE,"platform":"shopify"
        }
        resp=None
        for attempt in range(6):
            resp=session.get(ENDPOINT,params=params,timeout=30)
            if resp.status_code != 429:
                break
            time.sleep(5*(attempt+1))
        pages=page
        status_notes.append({"page":page,"status":resp.status_code,"ctype":resp.headers.get("content-type"),"bytes":len(resp.content)})
        if page==1:
            probes[code]={"url":resp.url,"status":resp.status_code,"content_type":resp.headers.get("content-type"),"sample":resp.text[:12000]}
        if resp.status_code != 200: break
        rows=[]
        try:
            data=resp.json()
            if page==1 and isinstance(data,dict):
                expected=data.get("number_of_reviews")
            dict_reviews=extract_dict_reviews(data)
            rows=[from_dict(r,code,product,url) for r in dict_reviews]
            # Many Judge.me widget payloads put the cards in an HTML string.
            if not rows:
                html_candidates=[]
                def walk_html(x):
                    if isinstance(x,dict):
                        for v in x.values(): walk_html(v)
                    elif isinstance(x,list):
                        for v in x: walk_html(v)
                    elif isinstance(x,str) and ("jdgm-rev" in x or "review" in x.lower()):
                        html_candidates.append(x)
                walk_html(data)
                for h in html_candidates: rows.extend(parse_html(h,code,product,url))
        except Exception:
            rows=parse_html(resp.text,code,product,url)
        # fallback parse raw body even if JSON extraction found nothing
        if not rows and "jdgm" in resp.text:
            rows=parse_html(resp.text,code,product,url)
        before=len(seen)
        for r in rows: seen.setdefault(r["fingerprint"],r)
        if expected is not None and len(seen) >= int(expected):
            break
        if not rows or len(seen)==before:
            if page > 1: break
        time.sleep(2.0)
    rs=list(seen.values())
    for r in rs:
        r["shopify_product_id"]=pid
    all_rows.extend(rs)
    logs.append({
        "product_code":code,"product":product,"shopify_product_id":pid,"url":url,
        "pages_requested":pages,"expected_reviews":expected,"scraped_reviews":len(rs),"match":(len(rs)==int(expected) if expected is not None else None),"page_statuses":status_notes
    })

for i,r in enumerate(all_rows,1): r["raw_id"]=f"RAW{i:04d}"
(OUT/"reviews.json").write_text(json.dumps(all_rows,ensure_ascii=False,indent=2),encoding="utf-8")
(OUT/"log.json").write_text(json.dumps(logs,ensure_ascii=False,indent=2),encoding="utf-8")
(OUT/"probe.json").write_text(json.dumps(probes,ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps(logs,indent=2))
