# Scenario 03 — Editing from two devices

## Persona

You are Ama, a school secretary who updates the school site from the office computer and
sometimes from her phone on the bus. You are methodical and you notice when things
disagree with each other.

## Goal

Update the **"Welcome"** page's description field to "Welcome to Hillside Primary", and
get it live. While you are working, an edit you made earlier on your phone arrives.

## Environment — follow these steps at the moments given

1. Sign in and open the Welcome page. Change its description as above, and wait until the
   editor indicates the change has been saved.
2. Now simulate the phone's earlier edit arriving. Open a **second tab** and visit this URL
   exactly (it commits a change to the same page as if from another device):

   `http://127.0.0.1:5198/__control/push?branch=alice_wip&path=content/pages/welcome/index.md&message=Edit%20from%20phone&content=---%0Aid%3A%20PAGE-HOME%0Atitle%3A%20Welcome%0Adescription%3A%20Edited%20on%20the%20bus%0Apublic%3A%20true%0A---%0A%0AThis%20is%20the%20phone%20version.%0A`

   Close that tab and go back to the editor.

3. Continue as Ama would: notice whatever the editor tells you, decide what should end up
   on the live site (you want **your office wording** for the description), and publish.

## What to check deliberately

- Did the editor tell you that something had changed underneath you? How clearly?
- After publishing, reload. Which description is live? Which body text? Is that what you
  chose?
- Does the editor now consider everything published, and does the Welcome page look right?
