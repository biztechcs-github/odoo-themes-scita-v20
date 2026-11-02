import { registry } from "@web/core/registry";
import lazyloader from "@web/public/lazyloader";

/**
 * A button tapped before the lazy JS was loaded is held by the lazy loader and clicked again once
 * the interactions are set up; the interaction service also holds clicks until the interactions
 * are started, but replays them only once, right after starting them. A replay arriving after that
 * (its button's interaction already started, others still starting) was held for good: the button
 * kept its spinner, disabled, and the tap did nothing ("View in 3D", add to cart...). On phones
 * Theme Scita loads that JS at the first touch (lazyloader_deferred.js), so that first tap hit it
 * often. The lazy loader now replays once every interaction has started (at most 5s).
 */
const MAX_WAIT = 5000;
const interactionsStarted = Promise.withResolvers();
lazyloader.registerPageReadinessDelay(interactionsStarted.promise);
setTimeout(interactionsStarted.resolve, MAX_WAIT);

registry.category("services").add("theme_scita.lazy_click_replay_guard", {
    dependencies: ["public.interactions"],
    start(env, { "public.interactions": interactions }) {
        interactions.isReady.then(interactionsStarted.resolve, interactionsStarted.resolve);
    },
});
