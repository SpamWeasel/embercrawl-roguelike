Your own sound effects go in this folder.

Every sound in Embercrawl is made in code, so this folder can stay empty. To replace one, add a
file named after the sound's id (.ogg, .mp3 or .wav), then rebuild:

    hit.ogg              replaces the "hit" sound
    hit-1.ogg, hit-2.ogg several takes; one is picked at random each time

The ids and what each sound is for are listed in Settings > Sound > "Listen to each sound", and in
docs/DEVELOPMENT_GUIDE.md. Keep files short and quiet at the start and end (no clicks); the game
sets their volume and places them left or right. The "ambience" file loops, so its end should flow
into its start.
