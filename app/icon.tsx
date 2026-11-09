import { ImageResponse } from "next/og";

// The app's web icon: the same "signal ping" motif as the starfield clicks
// and the loading dot. Generated in code so there's no binary file to ship.
// Colors mirror --void and --signal in globals.css (CSS variables aren't
// available inside ImageResponse).
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#06070c",
          borderRadius: 14,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 46,
            height: 46,
            borderRadius: 23,
            border: "6px solid #ff2f6d",
          }}
        >
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: 10,
              background: "#ff2f6d",
            }}
          />
        </div>
      </div>
    ),
    size
  );
}
