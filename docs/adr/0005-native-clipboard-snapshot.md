# Native clipboard snapshot before replacement

V0 will use a native Windows clipboard snapshot to preserve common clipboard formats before the app sends copy or paste keystrokes. This adds implementation complexity, but it protects the user's clipboard from being corrupted by the **Replacement Flow**; if the snapshot cannot be captured, the app fails safely before mutating the clipboard.
