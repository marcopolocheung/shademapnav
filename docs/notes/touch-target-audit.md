# Touch Target Audit

Date: 2026-08-16

Scope: timeline slider, day slider, bottom sheet, and floating map controls for a heatwave user outdoors on a phone, one-handed.

## Findings

| Surface | Result | Notes |
| --- | --- | --- |
| Time scrubber | Pass | Track is `h-11` (44px) and draggable across the full width. |
| Day scrubber | Pass | Track is 48px tall and draggable across the full width. |
| Timeline controls row | Fixed | Play, time/day toggle, time input, date input, and year controls now expose at least 44px height. |
| Bottom sheet drag handle | Fixed | Pointer capture area increased from 32px to 44px, with a 44px handle row. |
| Floating map controls | Pass | Buttons are 48px square and remain bottom-right on mobile, above the bottom sheet. |

## Thumb Reach

Primary mobile actions stay in the bottom sheet or near the lower-right map edge, which keeps route entry, timeline control, and map controls in the one-handed thumb zone. The only intentionally full-width gestures are the timeline/day scrubbers, where horizontal dragging is the primary interaction.
