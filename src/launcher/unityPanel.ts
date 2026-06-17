import { checkUnityBuild, unityBuildUrl } from "./mode";

/**
 * Fill `host` with the Unity WebGL build (an iframe over the served
 * `/unity/` build), or a friendly "not built yet" placeholder when the
 * build is absent. `onBack` returns the player to the native intro.
 */
export async function launchUnity(
  host: HTMLElement,
  onBack: () => void,
): Promise<void> {
  host.innerHTML = "";
  host.classList.add("show");

  const back = document.createElement("button");
  back.className = "unity-back";
  back.textContent = "← Back to menu";
  back.addEventListener("click", () => {
    host.classList.remove("show");
    host.innerHTML = "";
    onBack();
  });
  host.appendChild(back);

  const available = await checkUnityBuild((url) =>
    fetch(url, { method: "HEAD" }),
  );
  if (available) {
    const frame = document.createElement("iframe");
    frame.className = "unity-frame";
    frame.src = unityBuildUrl();
    frame.title = "Clash Royale — Unity edition";
    host.appendChild(frame);
  } else {
    host.appendChild(buildPlaceholder());
  }
}

/** Shown until someone drops a Unity WebGL build into `public/unity/`. */
function buildPlaceholder(): HTMLElement {
  const box = document.createElement("div");
  box.className = "unity-placeholder";

  const title = document.createElement("h2");
  title.textContent = "Unity edition — not built yet";
  box.appendChild(title);

  const p1 = document.createElement("p");
  p1.innerHTML =
    "The Unity project lives in <code>unity/ClashRoyaleUnity</code>. " +
    "Open it in Unity, then build for WebGL into <code>public/unity/</code> " +
    "so it is served next to this native version.";
  box.appendChild(p1);

  const p2 = document.createElement("p");
  p2.innerHTML =
    "See <code>unity/README.md</code> for full build steps. Until then, " +
    "use the <strong>Native</strong> version from the menu.";
  box.appendChild(p2);

  return box;
}
