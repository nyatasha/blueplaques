# Blue Plaques Map

Interactive map of all English Heritage blue plaques in London, with fame highlighting based on Wikipedia monthly pageviews.

**Live site:** https://nyatasha.github.io/blueplaques/

## Data

Plaque data from [OpenPlaques](https://openplaques.org) (public domain).  
Fame scores from Wikipedia pageview API.

## Setup

```bash
# 1. Download and filter plaque data
python3 scripts/fetch_plaques.py

# 2. Add Wikipedia fame scores
python3 scripts/add_fame.py

# 3. Serve locally
python3 -m http.server 8000
# open http://localhost:8000
```

## Updating data

Re-run both scripts and commit the updated `data/plaques.geojson`:

```bash
python3 scripts/fetch_plaques.py
python3 scripts/add_fame.py
git add data/plaques.geojson
git commit -m "refresh plaque data"
git push
```
