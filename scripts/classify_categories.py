#!/usr/bin/env python3
"""
Classify every plaque in data/plaques.geojson into one top-level category.

Adds two properties to each feature:

    "category":       "writers"
    "category_label": "Writers & Literature"

Classification is fully deterministic and runs offline — the deployed site never
calls an AI API (PRD §17). Three layers, in order of precedence:

    1. OVERRIDES     — plaque id → category, for cases the rules get wrong.
    2. Keyword rules — weighted matches over `lead_roles` (weight ×3) and
                       `inscription` (weight ×1).
    3. Fallback      — "other".

Usage:
    python3 scripts/classify_categories.py            # classify + write
    python3 scripts/classify_categories.py --report   # classify + print samples
    python3 scripts/classify_categories.py --dry-run  # classify, write nothing
"""

import json
import os
import re
import sys
from collections import Counter, defaultdict

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
GEOJSON = os.path.join(PROJECT_ROOT, "data", "plaques.geojson")

# ── Taxonomy ─────────────────────────────────────────────────────────────────
# Order is also the tie-break priority: earlier wins an exact score tie.
CATEGORIES = [
    ("writers",      "Writers & Literature"),
    ("art",          "Art & Design"),
    ("science",      "Science & Technology"),
    ("film-theatre", "Film & Theatre"),
    ("music",        "Music"),
    ("politics",     "Politics & Society"),
    ("architecture", "Architecture"),
    ("sport",        "Sport"),
    ("other",        "Other"),
]
LABELS = dict(CATEGORIES)
PRIORITY = {slug: i for i, (slug, _) in enumerate(CATEGORIES)}

DECISIVE, STRONG, WEAK = 25, 10, 4
ROLE_WEIGHT, INSCRIPTION_WEIGHT = 3, 1

# ── Keyword rules ────────────────────────────────────────────────────────────
# A keyword containing a backslash is used as a raw regex; a trailing "*"
# matches any word continuation ("architect*" hits architect, architects,
# architectural, architecture). Everything else is matched whole-word.
#
# DECISIVE is reserved for phrases that must beat a strong signal in the other
# direction — "social scientist" is society, not science; "theatre architect"
# is architecture, not theatre.
RULES = {
    "writers": {
        DECISIVE: ["writer on", "author of", "creator of sherlock holmes",
                   "creator of james bond", "creator of dr fu manchu",
                   "creator of peter pan", "compiler of the golden treasury"],
        STRONG: [
            "poet*", "novelist*", "writer*", "author*", "playwright*", "dramatist*",
            "essayist*", "biographer*", "diarist*", "journalist*", "publisher*",
            "editor*", "bookseller*", "librettist*", "lexicographer*", "translator*",
            "man of letters", "woman of letters", "literary*", "literature",
            "short story", "crime writer", "detective novel*", "detective story",
            "children's writer", "screenwriter*", "scriptwriter*", "columnist*",
            "poet laureate", "nobel literature", "wrote", "writings",
            "book*", "novel*", "verse", "memoir*", "pamphleteer*", "satirist*",
        ],
        WEAK: [
            "historian*", "scholar*", "critic*", "grammarian*", "antiquar*",
            "printer*", "press", "publishing", "wit", "orientalist*",
        ],
    },
    "art": {
        DECISIVE: ["type foundry", "letter founder", "sporting painter"],
        STRONG: [
            "painter*", "paint*", "artist*", "sculptor*", "sculpt*", "illustrator*",
            "illustrat*", "cartoonist*", "caricaturist*", "photographer*",
            "engraver*", "etcher*", "draughtsman*", "potter*", "ceramic*",
            "stained glass", "calligrapher*", "typographer*", "typefac*",
            "graphic artist*", "photomontage", "royal academician", "pre-raphaelite",
            "camden town group", "fashion designer*", "furniture designer*",
            "textile designer*", "dressmaker*", "couturier*", "milliner*",
            "wax artist*", "aesthete*", "watercolour*", "portraitist*", "muralist*",
            "designer in flowers", "art nouveau", "wood engraver*", "printmaker*",
            "art historian*", "goldsmith*", "silversmith*",
            "designer of the london underground map", "designer of spitalfields silks",
        ],
        WEAK: ["designer*", "design*", "gallery", "studio*", "craft*", "tailor*"],
    },
    "science": {
        DECISIVE: ["namer of clouds", "powered flight", "mental illness"],
        STRONG: [
            "scientist*", "physicist*", "chemist*", "chemistry", "biologist*",
            "biochemist*", "mathematician*", "mathematic*", "engineer*", "engineering",
            "inventor*", "invented", "invention*", "naturalist*", "botanist*",
            "zoologist*", "astronomer*", "astronomy", "physician*", "surgeon*",
            "surgery", "doctor", "medicine", "medical*", "mbbs", "anatomist*",
            "physiolog*", "psychoanaly*", "psychiatr*", "psycholog*", "neurolog*",
            "neurosurgeon*", "immunolog*", "crystallograph*", "geologist*",
            "archaeolog*", "egyptolog*", "pharmac*", "dentist*", "dental",
            "ophthalm*", "dermatolog*", "paediatric*", "pathologist*", "radiolog*",
            "bacteriolog*", "epidemiolog*", "nurse*", "nursing", "hospital",
            "matron*", "asylum*", "man of science", "code-breaker*", "cryptanalyst*",
            "computing", "computer*", "designer of colossus", "television pioneer*",
            "aviation pioneer*", "aircraft*", "aeroplane*", "aeronaut*", "aviator*",
            "explorer*", "exploration", "antarctic", "arctic", "polar",
            "discoverer of", "discovered", "statistician*", "statistics",
            "meteorolog*", "hydrograph*", "metallurg*", "microscop*", "electrical*",
            "wireless", "telegraph*", "holography", "penicillin", "vaccin*",
            "x-ray*", "anaesthe*", "obstetric*", "veterinary", "horticultur*",
            "plant collector*", "chronometer*", "watchmaker*", "optician*",
            "machinery", "screw-propeller", "diving helmet", "molecular structures",
            "pioneer of motoring", "pioneer of computing", "pioneer statistician",
            "scientific*", "sexolog*",
        ],
        WEAK: [
            "fellow of the royal society", "professor*", "laborator*",
            "researcher*", "research", "royal society", "traveller*", "travelled",
        ],
    },
    "film-theatre": {
        DECISIVE: ["music hall", "muppets"],
        STRONG: [
            "actor*", "actress*", "acting", "actor-manager*", "comedian*", "comic*",
            "comedy", "film director*", "film producer*", "film maker*", "filmmaker*",
            "film*", "cinema*", "theatre*", "theatrical*", "theater*", "stage",
            "entertainer*", "clown*", "magician*", "ventriloquis*", "puppet*",
            "impresario*", "shakespearian actor*", "dancer*", "ballet*", "ballerina*",
            "choreograph*", "old vic", "pantomime*", "variety artist*", "revue",
            "broadcaster*", "bbc", "television", "producer*", "director of plays",
            "artiste*", "showman*", "circus", "mime",
        ],
        WEAK: ["performer*", "star of", "manager of", "conjuror*"],
    },
    "music": {
        DECISIVE: ["writer on music"],
        STRONG: [
            "composer*", "composed", "musician*", "singer*", "sang", "conductor*",
            "pianist*", "violinist*", "cellist*", "guitarist*", "organist*",
            "organ builder*", "tenor*", "contralto*", "soprano*", "baritone*",
            "bass-baritone*", "songwriter*", "song writer*", "band leader*",
            "bandleader*", "dance band", "horn player*", "viola player*",
            "flautist*", "harpsichord*", "opera*", "operatic*", "symphon*",
            "concerto*", "oratorio*", "folk song*", "jazz", "rock band",
            "musical director*", "queen of song", "chorister*",
            "lyricist*", "melod*", "recital*", "orchestra*",
        ],
        WEAK: ["musical*", "song*", "hymn*"],
    },
    "politics": {
        DECISIVE: ["social scientist*", "social science*", "free trade",
                   "friend of all in need", "racial equality", "prime minister*",
                   "social survey*"],
        STRONG: [
            "politician*", "political*", "statesman*", "stateswoman*",
            "prime minister*", "president*", "member of parliament", r"\bmp\b",
            "cabinet*", "minister*", "secretary of state", "foreign secretary",
            "home secretary", "chancellor*", "lord privy seal", "privy counsellor*",
            "parliament*", "ambassador*", "diplomat*", "consul*", "viceroy*",
            "colonial administrator*", "governor*", "government*", "mayor*",
            "councillor*", "county council", "campaigner*", "campaign*", "activist*",
            "reformer*", "reform*", "suffragist*", "suffragette*", "suffrage",
            "trade union*", "trade unionist*", "strike", "strikers",
            "socialist*", "communist*", "revolutionary*", "revolution",
            "patriot*", "philanthropist*", "philanthrop*", "abolitionist*",
            "anti-slavery", "slavery", "women's rights", "freedom fighter*",
            "human rights", "civil rights", "independence", "nationalist*",
            "liberator*", "ruler of", "rajah*", "maharaja*", "sultan*",
            "soldier*", "general*", "admiral*", "field-marshal*", "field marshal*",
            "brigadier*", "colonel*", "lieutenant*", "commander*", "air chief marshal",
            "royal navy", "royal air force", r"\braf\b", "british army", "war hero*",
            "first sea lord", "chief scout", r"\bspy\b", "spies", "secret agent*",
            "special operations executive", "resistance", "auschwitz", "rescuer*",
            "police", "fire brigade", "lawyer*", "barrister*", "solicitor*",
            r"\bjudge\w*", "jurist*", "law student",
            "philosopher*", "philosoph*", "theolog*", "preacher*", "evangelist*",
            "missionar*", "bishop*", "cardinal*", "rabbi*", r"\bimam\b",
            "spiritual leader*", "religious*", "clergyman*", r"\bvicar\b",
            r"\breverend\b", "unitarian*", "methodist*", "quaker*",
            "economist*", "economics", "social reformer*", "social research*",
            "social worker*", "prison reform*", "housing reform*", "health reform*",
            "public health", "education*", "benefactor*", "family allowances",
            "orator*", "pacifist*", "feminist*", "labour party", r"\btory\b",
            "liberal party", "civil servant*", "sociolog*", "anthropolog*",
            "banker*", "entrepreneur*", "industrialist*", "department store",
            "merchant*", "shipowner*", "catering", "caterer*", "restaurateur*",
        ],
        WEAK: [
            "society", "leader*", "movement", "committee", "council", "association",
            "founder of", r"\bking\b", r"\bqueen\b", "prince*", "princess*",
            r"\bearl\b", r"\bbaron\w*", "viscount*", "marquess*", "marchioness*",
            r"\bduke\b", "duchess*", r"\blord\b", r"\blady\b", "baronet*",
            "knight*", r"\bdame\b", "manufactur*",
        ],
    },
    "architecture": {
        DECISIVE: ["theatre architect", "landscape architect", "gothic architect"],
        STRONG: [
            "architect*", "master builder*", "town planning",
            "town and country planning", "garden city", "surveyor*",
            "landscape gardener*", "city planner*", "urban design*", "builder of",
        ],
        WEAK: ["builder*", "building*", r"\bhouses\b", "estate*"],
    },
    "sport": {
        STRONG: [
            "cricketer*", "cricket", "footballer*", "football*", "boxer*", "boxing",
            "pugilist*", "bare knuckle", "tennis", "golfer*", r"\bgolf\b",
            "athlete*", "athletics", "olympic*", "racing driver*", "motor racing",
            "speed record*", "rowing", "oarsman*", "chess", "body-builder*",
            "swimmer*", "jockey*", "sportsman*", "sportswoman*", "sportsperson*",
            "mountaineer*", "climber*", "wrestler*", "cyclist*", "rugby",
            "world champion", "champion of the world", "welterweight", "heavyweight",
        ],
        WEAK: ["champion*", r"\bcoach\b", r"\bclub\b"],
    },
}

# ── Manual overrides ─────────────────────────────────────────────────────────
# plaque id → category slug. Reserved for high-profile or genuinely ambiguous
# figures the keyword rules place badly (PRD §17.3). Each is justified.
OVERRIDES: dict[str, str] = {
    "480":  "politics",  # Mahatma Gandhi — role reads "law student"
    "319":  "politics",  # Mahatma Gandhi (second plaque)
    "9720": "politics",  # Harold Moody — physician, but commemorated as a
                         # campaigner for racial equality

    # Early scheme plaques (Society of Arts, LCC), added when the colour filter
    # was dropped. The rules were tuned on modern plaques whose roles are stated
    # plainly; these use older wording that trips them.
    "463":  "art",          # Thomas Chippendale — "cabinet maker" scores on
                            # "cabinet"; furniture design, not government
    "1973": "science",      # Henry Cavendish — "natural philosopher" is the
                            # 18th-century word for physicist
    "704":  "politics",     # Bow Street — lead subject is Sir John Fielding,
                            # magistrate; the inscription also names his
                            # novelist brother, which pulls it to writers
    "5":    "politics",     # Arthur Onslow — Speaker of the House of Commons
    "450":  "film-theatre", # Samuel Phelps — "tragedian" i.e. actor-manager
    "249":  "science",      # Hugh Willoughby — navigator; exploration sits in
                            # Science & Technology (decision-log #11)
    "348":  "politics",     # Benjamin Franklin — inscription is bare dates, so
                            # nothing scores; commemorated here as a statesman
}

# ── Matching ─────────────────────────────────────────────────────────────────


def to_pattern(kw: str) -> str:
    """Keyword → regex. Backslash present ⇒ raw regex; trailing * ⇒ word stem."""
    if "\\" in kw:
        return kw.replace("*", r"\w*")
    if kw.endswith("*"):
        return r"\b" + re.escape(kw[:-1]) + r"\w*"
    return r"\b" + re.escape(kw) + r"\b"


def compile_rules():
    compiled = []
    for slug, buckets in RULES.items():
        for weight, keywords in buckets.items():
            for kw in keywords:
                compiled.append((slug, weight, re.compile(to_pattern(kw)), kw))
    return compiled


COMPILED = compile_rules()


def normalise(text: str) -> str:
    return re.sub(r"[‘’]", "'", (text or "").lower())


def score(props: dict) -> tuple[dict, dict]:
    """Return (scores by category, matched keywords by category)."""
    sources = [
        (normalise(props.get("lead_roles", "")), ROLE_WEIGHT),
        (normalise(props.get("inscription", "")), INSCRIPTION_WEIGHT),
    ]
    scores: dict[str, int] = defaultdict(int)
    matched: dict[str, set] = defaultdict(set)
    for slug, weight, rx, kw in COMPILED:
        for text, mult in sources:
            if text and rx.search(text):
                # A decisive phrase is decisive wherever it appears — an
                # inscription reading "Prime Minister" outranks a role of
                # "Royal Academician".
                scores[slug] += weight * (ROLE_WEIGHT if weight == DECISIVE else mult)
                matched[slug].add(kw)
    return scores, matched


def classify(props: dict) -> tuple[str, dict, dict]:
    pid = props.get("id", "")
    if pid in OVERRIDES:
        return OVERRIDES[pid], {}, {}
    scores, matched = score(props)
    if not scores:
        return "other", scores, matched
    best = max(scores.items(), key=lambda kv: (kv[1], -PRIORITY[kv[0]]))
    return best[0], scores, matched


# ── Main ─────────────────────────────────────────────────────────────────────


def main() -> None:
    report = "--report" in sys.argv
    dry_run = "--dry-run" in sys.argv

    with open(GEOJSON, encoding="utf-8") as f:
        data = json.load(f)
    features = data["features"]

    counts = Counter()
    samples = defaultdict(list)
    unmatched = []

    for feat in features:
        props = feat["properties"]
        slug, scores, matched = classify(props)
        props["category"] = slug
        props["category_label"] = LABELS[slug]
        counts[slug] += 1
        if len(samples[slug]) < 12:
            hits = ", ".join(sorted(matched.get(slug, []))[:4])
            samples[slug].append(f"{props.get('title','?')} [{props.get('lead_roles','')}] ← {hits}")
        if slug == "other":
            unmatched.append((props.get("title", "?"), props.get("lead_roles", "")))

    if not dry_run:
        with open(GEOJSON, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

    total = len(features)
    print(f"Classified {total} plaques into {len(CATEGORIES)} categories"
          f"{' (dry run — nothing written)' if dry_run else f' → {GEOJSON}'}\n")
    for slug, label in CATEGORIES:
        n = counts[slug]
        bar = "█" * round(n / total * 40)
        print(f"  {label:<22} {n:>4}  {n/total*100:>5.1f}%  {bar}")
    print(f"\n  overrides applied: {len(OVERRIDES)}")

    if report:
        for slug, label in CATEGORIES:
            print(f"\n── {label} ({counts[slug]}) " + "─" * 30)
            for s in samples[slug]:
                print("   ", s)
        print(f"\n── unclassified ({len(unmatched)}) " + "─" * 26)
        for title, roles in unmatched:
            print(f"    {title}  [{roles}]")


if __name__ == "__main__":
    main()
