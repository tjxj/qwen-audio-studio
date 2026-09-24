import {
  createContext,
  useContext,
  useEffect,
  type PropsWithChildren,
} from "react";

class PlaybackCoordinator {
  private owner: HTMLMediaElement | null = null;
  claim(element: HTMLMediaElement) {
    if (this.owner && this.owner !== element) this.owner.pause();
    // Include native previews and library players, even when they do not use a hook.
    document.querySelectorAll("audio, video").forEach((media) => {
      if (
        media !== element &&
        media instanceof HTMLMediaElement &&
        !media.paused
      )
        media.pause();
    });
    this.owner = element;
  }
  owns(element: HTMLMediaElement) {
    return this.owner === element;
  }
  release(element: HTMLMediaElement) {
    element.pause();
    if (this.owner === element) this.owner = null;
  }
  releaseDetached() {
    if (this.owner && !this.owner.isConnected) this.release(this.owner);
  }
  stop() {
    if (this.owner) this.release(this.owner);
  }
}

const sharedPlayback = new PlaybackCoordinator();
const PlayerContext = createContext(sharedPlayback);

export function PlayerProvider({ children }: PropsWithChildren) {
  useEffect(() => {
    const onPlay = (event: Event) => {
      if (event.target instanceof HTMLMediaElement)
        sharedPlayback.claim(event.target);
    };
    document.addEventListener("play", onPlay, true);
    const observer = new MutationObserver(() =>
      sharedPlayback.releaseDetached(),
    );
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      document.removeEventListener("play", onPlay, true);
      observer.disconnect();
      sharedPlayback.stop();
    };
  }, []);
  return (
    <PlayerContext.Provider value={sharedPlayback}>
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlaybackCoordinator() {
  return useContext(PlayerContext);
}
