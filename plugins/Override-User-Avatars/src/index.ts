import { findByProps, findByStoreName } from "@vendetta/metro";
import { FluxDispatcher } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";

// tag added to all print statements to help with debugging with logcat on adb
const TAG = "[custom-avatars]";

let patches = [];

export { default as settings } from "./settings";

export interface AvatarOverride {
    id: string;
    url: string;
}

// migrate the old single-user settings (targetUserId / imageUrl) into the new list
function initStorage(): void {
    if (!Array.isArray(storage.overrides)) {
        storage.overrides = [];
    }

    if (storage.targetUserId || storage.imageUrl) {
        if (storage.targetUserId && storage.imageUrl) {
            storage.overrides = [
                ...storage.overrides,
                { id: storage.targetUserId, url: storage.imageUrl }
            ];
        }
        delete storage.targetUserId;
        delete storage.imageUrl;
    }
}

// looks up the override at call time so edits in settings apply without reloading
function getOverrideUrl(userId?: string): string | undefined {
    if (!userId) return undefined;
    const list: AvatarOverride[] = storage.overrides ?? [];
    for (const entry of list) {
        if (entry?.id?.trim() === userId && entry.url?.trim()) {
            return entry.url.trim();
        }
    }
    return undefined;
}

export function onLoad(): void {
    console.log(`${TAG} loaded`);

    initStorage();

    const UserStore = findByStoreName("UserStore");
    if (!UserStore) {
        console.log(`${TAG} userStore not found`);
        return;
    }

    const avatarModule = findByProps("getUserAvatarURL");
    if (!avatarModule) {
        console.log(`${TAG} avatar module not found`);
        return;
    }

    // patch getUserAvatarSource, overrides avatar in DMs and group chats
    if (avatarModule.getUserAvatarSource) {
        const originalGetUserAvatarSource = avatarModule.getUserAvatarSource;
        avatarModule.getUserAvatarSource = function (...args) {
            const overrideUrl = getOverrideUrl(args[0]?.id);

            // only intercept users that have an override
            if (overrideUrl) {
                const original = originalGetUserAvatarSource.apply(this, args);
                if (original) {
                    return {
                        ...original,
                        uri: overrideUrl
                    };
                }
            }
            // ignore everyone else
            return originalGetUserAvatarSource.apply(this, args);
        };
        patches.push(() => { avatarModule.getUserAvatarSource = originalGetUserAvatarSource; });
    }

    // patch getUserAvatarURL, overrides avatar in voice calls
    const originalGetUserAvatarURL = avatarModule.getUserAvatarURL;
    avatarModule.getUserAvatarURL = function (...args) {
        const overrideUrl = getOverrideUrl(args[0]?.id);
        // only intercept for users that have an override
        if (overrideUrl) {
            return overrideUrl;
        }
        // ignore other users
        return originalGetUserAvatarURL.apply(this, args);
    };
    patches.push(() => { avatarModule.getUserAvatarURL = originalGetUserAvatarURL; });

    console.log(`${TAG} patches applied`);

    // refresh ui for every overridden user
    for (const entry of storage.overrides as AvatarOverride[]) {
        try {
            const user = entry?.id ? UserStore.getUser(entry.id.trim()) : null;
            if (user) {
                FluxDispatcher.dispatch({ type: "USER_UPDATE", user });
            }
        } catch (e) {
            console.log(`${TAG} could not trigger refresh for ${entry?.id}:`, e.message);
        }
    }
    console.log(`${TAG} ui refreshed`);
}

export function onUnload(): void {
    console.log(`${TAG} unloading...`);

    // restore patches
    patches.forEach(unpatch => unpatch());
    patches = [];

    console.log(`${TAG} unloaded`);
}
