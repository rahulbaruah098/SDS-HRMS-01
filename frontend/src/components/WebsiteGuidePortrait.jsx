export default function WebsiteGuidePortrait({
  compact = false,
  avatar = false,
}) {
  return (
    <svg
      className={`website-guide-portrait-svg${
        compact ? " is-compact" : ""
      }${avatar ? " is-avatar" : ""}`}
      viewBox="0 0 240 260"
      role="img"
      aria-label="YourComate HRMS helper mascot"
    >
      <defs>
        <linearGradient
          id="ycHelperHelmet"
          x1="0"
          y1="0"
          x2="1"
          y2="1"
        >
          <stop offset="0" stopColor="#63d5ff" />
          <stop offset="0.52" stopColor="#6984f3" />
          <stop offset="1" stopColor="#6558d9" />
        </linearGradient>

        <linearGradient
          id="ycHelperSuit"
          x1="0"
          y1="0"
          x2="1"
          y2="1"
        >
          <stop offset="0" stopColor="#8be0f6" />
          <stop offset="1" stopColor="#6e71df" />
        </linearGradient>

        <linearGradient
          id="ycHelperPanel"
          x1="0"
          y1="0"
          x2="1"
          y2="1"
        >
          <stop offset="0" stopColor="#dfff5f" />
          <stop offset="1" stopColor="#7fd0ae" />
        </linearGradient>

        <linearGradient
          id="ycHelperCard"
          x1="0"
          y1="0"
          x2="1"
          y2="1"
        >
          <stop offset="0" stopColor="#fff6c7" />
          <stop offset="1" stopColor="#ffd95f" />
        </linearGradient>
      </defs>

      <ellipse
        className="yc-helper-ground-shadow"
        cx="120"
        cy="239"
        rx="61"
        ry="10"
        fill="rgba(23, 33, 63, 0.12)"
      />

      <g className="yc-helper-character">
        <g className="yc-helper-antenna">
          <path
            d="M120 34V19"
            fill="none"
            stroke="#17213f"
            strokeWidth="4"
            strokeLinecap="round"
          />

          <circle
            className="yc-helper-antenna-tip"
            cx="120"
            cy="14"
            r="7"
            fill="#ffd95f"
            stroke="#17213f"
            strokeWidth="3"
          />
        </g>

        <g className="yc-helper-head">
          <path
            d="M62 84c0-39 24-66 58-66 35 0 59 27 59 66v18c0 31-24 52-59 52-34 0-58-21-58-52Z"
            fill="url(#ycHelperHelmet)"
            stroke="#17213f"
            strokeWidth="4"
          />

          <path
            d="M75 83c0-27 18-46 45-46 28 0 46 19 46 46v16c0 24-18 40-46 40-27 0-45-16-45-40Z"
            fill="#fff8ef"
            stroke="#17213f"
            strokeWidth="3.5"
          />

          <path
            d="M73 70c10-24 27-35 50-35 17 0 31 7 41 21"
            fill="none"
            stroke="rgba(255,255,255,0.56)"
            strokeWidth="7"
            strokeLinecap="round"
          />

          <rect
            x="50"
            y="72"
            width="21"
            height="38"
            rx="10"
            fill="#42c8ed"
            stroke="#17213f"
            strokeWidth="3"
          />

          <rect
            x="169"
            y="72"
            width="21"
            height="38"
            rx="10"
            fill="#7fd0ae"
            stroke="#17213f"
            strokeWidth="3"
          />

          <g className="yc-helper-eyes">
            <ellipse
              className="yc-helper-eye"
              cx="103"
              cy="84"
              rx="6"
              ry="8"
              fill="#17213f"
            />

            <ellipse
              className="yc-helper-eye"
              cx="137"
              cy="84"
              rx="6"
              ry="8"
              fill="#17213f"
            />

            <circle
              cx="105"
              cy="81"
              r="2"
              fill="#ffffff"
            />

            <circle
              cx="139"
              cy="81"
              r="2"
              fill="#ffffff"
            />
          </g>

          <circle
            cx="91"
            cy="101"
            r="7"
            fill="#f39abe"
            opacity="0.72"
          />

          <circle
            cx="149"
            cy="101"
            r="7"
            fill="#f39abe"
            opacity="0.72"
          />

          <path
            d="M101 105c10 11 28 11 38 0"
            fill="none"
            stroke="#6558d9"
            strokeWidth="4"
            strokeLinecap="round"
          />

          <path
            d="M64 108c-14 4-23 13-27 27"
            fill="none"
            stroke="#17213f"
            strokeWidth="4"
            strokeLinecap="round"
          />

          <circle
            cx="35"
            cy="140"
            r="7"
            fill="#ffd95f"
            stroke="#17213f"
            strokeWidth="3"
          />
        </g>

        <g className="yc-helper-body">
          <path
            d="M80 142h80c18 0 31 13 33 31l6 55H41l6-55c2-18 15-31 33-31Z"
            fill="url(#ycHelperSuit)"
            stroke="#17213f"
            strokeWidth="4"
            strokeLinejoin="round"
          />

          <path
            d="M67 153c14 10 32 15 53 15 22 0 40-5 54-15"
            fill="none"
            stroke="rgba(255,255,255,0.5)"
            strokeWidth="5"
            strokeLinecap="round"
          />

          <rect
            x="88"
            y="166"
            width="64"
            height="43"
            rx="13"
            fill="url(#ycHelperPanel)"
            stroke="#17213f"
            strokeWidth="3"
          />

          <g className="yc-helper-hrms-badge">
            <circle
              className="yc-helper-chest-light"
              cx="103"
              cy="184"
              r="7"
              fill="#ffffff"
              stroke="#17213f"
              strokeWidth="2.5"
            />

            <path
              d="M118 178h22M118 188h16"
              fill="none"
              stroke="#30275f"
              strokeWidth="3.5"
              strokeLinecap="round"
            />

            <text
              x="120"
              y="202"
              textAnchor="middle"
              fill="#17213f"
              fontFamily="Inter, Arial, sans-serif"
              fontSize="8"
              fontWeight="900"
              letterSpacing="0.8"
            >
              HRMS
            </text>
          </g>

          <path
            d="M77 228v15M163 228v15"
            fill="none"
            stroke="#17213f"
            strokeWidth="5"
            strokeLinecap="round"
          />

          <path
            d="M62 243h31M147 243h31"
            fill="none"
            stroke="#17213f"
            strokeWidth="5"
            strokeLinecap="round"
          />
        </g>

        <g className="yc-helper-wave-arm">
          <path
            d="M51 164c-18 3-29 14-31 30"
            fill="none"
            stroke="#17213f"
            strokeWidth="16"
            strokeLinecap="round"
          />

          <path
            d="M51 164c-18 3-29 14-31 30"
            fill="none"
            stroke="#75cfe9"
            strokeWidth="10"
            strokeLinecap="round"
          />

          <circle
            cx="18"
            cy="198"
            r="12"
            fill="#fff8ef"
            stroke="#17213f"
            strokeWidth="3"
          />
          
        </g>

        <g className="yc-helper-card-arm">
          <path
            d="M187 164c17-1 28 7 34 21"
            fill="none"
            stroke="#17213f"
            strokeWidth="16"
            strokeLinecap="round"
          />

          <path
            d="M187 164c17-1 28 7 34 21"
            fill="none"
            stroke="#7672df"
            strokeWidth="10"
            strokeLinecap="round"
          />

          <g className="yc-helper-employee-card">
            <rect
              x="190"
              y="177"
              width="43"
              height="34"
              rx="8"
              fill="url(#ycHelperCard)"
              stroke="#17213f"
              strokeWidth="3"
            />

            <circle
              cx="204"
              cy="190"
              r="5"
              fill="#6558d9"
            />

            <path
              d="M198 201c2-5 10-5 12 0M216 187h10M216 194h8"
              fill="none"
              stroke="#17213f"
              strokeWidth="2.5"
              strokeLinecap="round"
            />

            <path
              d="M218 203l4 4 7-9"
              fill="none"
              stroke="#42a984"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        </g>
      </g>
    </svg>
  );
}
