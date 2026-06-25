# Context Glossary

## About Page

The About Page presents SIU as the subject. The Nikon D3500 is supporting evidence for SIU's visual practice, not the main product being showcased.

The About Page uses a lightweight 2D faux-3D camera presentation so the experience feels interactive without turning into a heavy 3D product page.

The camera visual should represent the real Nikon D3500 rather than a generic illustrated camera.

The preferred camera image source is SIU's own photo of the Nikon D3500. A temporary placeholder can be used during implementation, but the final portfolio should avoid unlicensed product imagery.

The About Page copy uses English as the primary portfolio language with small Traditional Chinese or Cantonese accents for personal texture.

The About Page should leave visitors remembering three identity points: SIU is a creative developer, a visual thinker, and a systems experimenter.

The About Page may include a compact proof strip of three to five existing photographs to support SIU's visual identity without turning the page into a gallery.

The About Page scroll interaction should be moderate: camera motion and spec reveals should add depth without making the page feel like an animation demo.

The About Page should be an independent portfolio view rather than a section inside the home page.

Nikon D3500 specifications on the About Page should be curated around SIU's creative practice rather than presented as a full hardware spec sheet.

## Creative Developer

SIU's portfolio identity is a creative developer: code is used to build tools, the camera is used to shape visual language, and AI or market systems are treated as experiments.

## Work Gallery

The Work Gallery is the primary portfolio view for apps and systems SIU built or replicated with AI agents.

The Work Gallery should lead with live, usable demos rather than static explanations.

The Work Gallery may include concise build notes, but those notes support the working product instead of replacing it.

AI Vision is not the main portfolio navigation concept; AI-built work belongs under the Work Gallery.

## Work Item

A Work Item is an individual app, dashboard, tool, or system in the Work Gallery.

A Work Item should explain what was built, what workflow inspired it, and what the visitor can try.

## Settle Up

Settle Up is a Work Item that turns a real group-expense spreadsheet workflow into a modern bill-splitting app.

Settle Up should preserve the core expense concepts: payer, amount, participants, net balance, and settlement transfers.

Settle Up should not look like a spreadsheet clone; the spreadsheet is a workflow reference, not a visual design.

## SPX GEX Heatmap

SPX GEX Heatmap is a Work Item that turns a premarket SPX options gamma workflow into a date-selectable visual map.

SPX GEX Heatmap should show retained JSON snapshots as a live product surface, not stored raw HTML.

SPX GEX Heatmap should treat seven trading days as the retention window, so weekends and NYSE full holidays do not consume retention slots.

## CBOE Chain Cache

CBOE Chain Cache is the 24-hour D1 cache of normalized SPX option chains from the CBOE delayed feed.

CBOE Chain Cache stores reusable upstream option-chain inputs for Worker jobs. It is not the SPX GEX Heatmap snapshot and should not be treated as the visual replay source.

SPX GEX Heatmap snapshots remain the retained intraday product surface for browsing and replay.

## Stocks Intelligence Watcher

Stocks Intelligence Watcher is a Work Item that turns the Stocks Intelligence MCP ticker workflow into a dense live ticker terminal.

Stocks Intelligence Watcher should lead with a usable watchlist, search, favorites, options expiry table, and OI/volume/GEX strike views rather than a static explanation.

Stocks Intelligence Watcher uses a repo-native Yahoo backend; the browser receives only normalized JSON from the Pages Function.

In Stocks Intelligence Watcher, an expiry row is a selectable expiration summary row. Clicking it changes the right-side Options panel to that expiration's OI, volume, GEX, DEX, Greeks, P/C, or chain data.

Contract rows belong in the Chain tab or strike drilldown. They are not the left-side expiry selector.
