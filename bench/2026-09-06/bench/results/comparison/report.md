# Transcription benchmark — 2026-09-12T14:33:55.055Z

Fixtures: `tmp\bench\results\fixtures.complete.json`; candidates: `tmp/tx/*/candidates/*.json`.

Reference kind matters: "existing-opus-json" is the old workflow's output, not adjudicated truth; a difference is a disagreement, not necessarily a candidate error.

| paper | reference | candidate | problems (ref/cand, missing, extra) | stmt sim | sol sim | numeric mismatches (stmt/sol) | LaTeX ≠ (stmt/sol) | table cells | LaTeX Δ | figures Δ | answers ≠ | points ≠ | valid | checker | receipt | reader $ | total $ | accepted $ | reader s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| psf-2025-proletno-10 | model-adjudicated | agent/haiku | 3/3, 0, 0 | 0.9461 | 0.9691 | 27/21 | 47/92 | 0 | -1 | 0 | 10 | 3 | yes | fail | — | — | — | — | — |
| psf-2025-proletno-10 | model-adjudicated | agent/sonnet | 3/3, 0, 0 | 0.9641 | 0.989 | 5/5 | 0/0 | 0 | 0 | 0 | 9 | 0 | yes | pass | — | — | — | — | — |
| psf-2025-proletno-10 | model-adjudicated | zai/glm-5.3-flash | 3/3, 0, 0 | 0.982 | 0.9944 | 0/6 | 0/12 | 0 | 0 | 0 | 7 | 3 | yes | fail | — | 0.009829 | — | — | 230.4 |
| psf-2024-proletno-9 | model-adjudicated | agent/haiku | 3/3, 0, 0 | 0.937 | 0.9864 | 7/0 | 13/35 | 0 | 3 | -1 | 8 | 3 | yes | fail | — | — | — | — | — |
| psf-2024-proletno-9 | model-adjudicated | agent/sonnet | 3/3, 0, 0 | 0.9964 | 1 | 2/0 | 0/0 | 0 | 0 | 0 | 0 | 0 | no | pass | — | — | — | — | — |
| psf-2024-proletno-9 | model-adjudicated | zai/glm-5.3-flash | 3/3, 0, 0 | 0.9776 | 0.9727 | 7/0 | 6/41 | 0 | 0 | 0 | 8 | 0 | no | fail | — | 0.011722 | — | — | 387.3 |
| nof-2024-ii-11 | model-adjudicated | agent/haiku | 3/3, 0, 0 | 0.5557 | 0.7345 | 753/19 | 16/88 | 768 | -8 | -2 | 8 | 3 | yes | fail | — | — | — | — | — |
| nof-2024-ii-11 | model-adjudicated | agent/sonnet | 3/3, 0, 0 | 0.5951 | 0.943 | 748/2 | 3/2 | 768 | -3 | 0 | 0 | 3 | yes | fail | — | — | — | — | — |
| nof-2024-ii-11 | model-adjudicated | zai/glm-5.3-flash | 3/3, 0, 0 | 0.5718 | 0.8889 | 747/4 | 7/75 | 768 | -5 | 0 | 4 | 3 | yes | pass | — | 0.008872 | — | — | 185.2 |
| psf-2006-proletno-sp | model-adjudicated | agent/haiku | 3/3, 0, 0 | 0.8109 | 0.5126 | 58/152 | 80/136 | 40 | -70 | -3 | 9 | 3 | yes | fail | — | — | — | — | — |
| psf-2006-proletno-sp | model-adjudicated | agent/sonnet | 3/3, 0, 0 | 0.9995 | 0.9794 | 0/6 | 0/2 | 0 | 0 | 0 | 2 | 3 | yes | pass | — | — | — | — | — |
| psf-2006-proletno-sp | model-adjudicated | zai/glm-5.3-flash | 3/3, 0, 0 | 0.9158 | 0.9369 | 28/51 | 29/104 | 60 | -1 | -1 | 6 | 3 | yes | fail | — | 0.011321 | — | — | 238.2 |
| esf-2010-esenno-7 | model-adjudicated | agent/haiku | 3/3, 0, 0 | 0.7868 | 0.4348 | 44/65 | 31/33 | 0 | -1 | 0 | 4 | 0 | yes | fail | — | — | — | — | — |
| esf-2010-esenno-7 | model-adjudicated | agent/sonnet | 3/3, 0, 0 | 1 | 1 | 0/2 | 2/2 | 0 | 0 | -1 | 1 | 0 | yes | fail | — | — | — | — | — |
| esf-2010-esenno-7 | model-adjudicated | zai/glm-5.3-flash | 3/3, 0, 0 | 0.8325 | 0.452 | 43/0 | 31/16 | 0 | 1 | -1 | 12 | 2 | no | fail | — | 0.006211 | — | — | 115.3 |
| esf-2002-esenno-st | model-adjudicated | agent/haiku | 6/5, 1, 0 | 0.4738 | 0.4609 | 25/66 | 44/79 | 0 | -42 | -6 | 7 | 3 | yes | fail | — | — | — | — | — |
| esf-2002-esenno-st | model-adjudicated | agent/sonnet | 6/6, 0, 0 | 0.9459 | 0.9817 | 20/8 | 12/30 | 0 | 10 | 0 | 1 | 0 | yes | pass | — | — | — | — | — |
| esf-2002-esenno-st | model-adjudicated | zai/glm-5.3-flash | 6/6, 0, 0 | 0.8674 | 0.5111 | 12/19 | 7/104 | 0 | -1 | 0 | 4 | 0 | no | fail | — | 0.006833 | — | — | 169.4 |
| nof-2009-iii | model-adjudicated | agent/haiku | 4/4, 0, 0 | 0.6371 | 0.488 | 81/274 | 113/131 | 70 | -101 | -2 | 17 | 4 | yes | pass | — | — | — | — | — |
| nof-2009-iii | model-adjudicated | agent/sonnet | 4/4, 0, 0 | 1 | 0.9645 | 2/5 | 2/2 | 0 | 0 | 0 | 1 | 0 | yes | fail | — | — | — | — | — |
| nof-2009-iii | model-adjudicated | zai/glm-5.3-flash | 4/4, 0, 0 | 0.9561 | 0.8414 | 30/103 | 60/146 | 124 | 0 | 0 | 11 | 4 | no | fail | — | 0.015045 | — | — | 302.3 |
| nao-2008-iv-st-prak | model-adjudicated | agent/haiku | 2/2, 0, 0 | 0.8363 | 0.7767 | 100/119 | 6/49 | 158 | 0 | 0 | 4 | 0 | yes | fail | — | — | — | — | — |
| nao-2008-iv-st-prak | model-adjudicated | agent/sonnet | 2/2, 0, 0 | 0.9697 | 0.9942 | 0/1 | 0/4 | 0 | 0 | 0 | 1 | 0 | yes | pass | — | — | — | — | — |
| nao-2008-iv-st-prak | model-adjudicated | zai/glm-5.3-flash | 2/2, 0, 0 | 0.9819 | 0.973 | 10/11 | 8/18 | 0 | -2 | -1 | 2 | 0 | yes | fail | — | 0.007915 | — | — | 117.3 |
| nof-2015-i-8 | model-adjudicated | agent/haiku | 3/3, 0, 0 | 0.789 | 0.9098 | 7/28 | 10/24 | 0 | 2 | -5 | 1 | 0 | yes | fail | — | — | — | — | — |
| nof-2015-i-8 | model-adjudicated | agent/sonnet | 3/3, 0, 0 | 0.9587 | 0.9974 | 0/0 | 1/0 | 0 | -1 | -4 | 1 | 0 | yes | fail | — | — | — | — | — |
| nof-2015-i-8 | model-adjudicated | zai/glm-5.3-flash | 3/3, 0, 0 | 0.9529 | 0.9903 | 9/4 | 9/23 | 0 | 3 | 0 | 1 | 0 | yes | fail | — | 0.006076 | — | — | 122.4 |
| nao-2023-ii-5-6 | model-adjudicated | agent/haiku | 5/5, 0, 0 | 0.962 | 0.8771 | 2/13 | 0/4 | 0 | 0 | -4 | 6 | 0 | yes | fail | — | — | — | — | — |
| nao-2023-ii-5-6 | model-adjudicated | agent/sonnet | 5/5, 0, 0 | 1 | 1 | 0/0 | 0/0 | 0 | 0 | -1 | 1 | 0 | yes | pass | — | — | — | — | — |
| nao-2023-ii-5-6 | model-adjudicated | zai/glm-5.3-flash | 5/5, 0, 0 | 0.9506 | 0.9645 | 7/40 | 0/6 | 0 | 0 | 0 | 4 | 0 | no | fail | — | 0.010225 | — | — | 116.1 |
| nof-2024-iii-11-12 | model-adjudicated | agent/haiku | 4/4, 0, 0 | 0.6597 | 0.527 | 318/319 | 158/188 | 164 | -158 | -2 | 25 | 4 | yes | fail | — | — | — | — | — |
| nof-2024-iii-11-12 | model-adjudicated | agent/sonnet | 4/4, 0, 0 | 0.8162 | 0.9611 | 278/27 | 68/4 | 152 | -68 | 0 | 7 | 0 | yes | fail | — | — | — | — | — |
| nof-2024-iii-11-12 | model-adjudicated | zai/glm-5.3-flash | 4/4, 0, 0 | 0.7687 | 0.9634 | 286/28 | 81/130 | 160 | -63 | -2 | 18 | 3 | no | fail | — | 0.01766 | — | — | 358.4 |
| psf-2026-proletno-8 | model-adjudicated | agent/haiku | 3/3, 0, 0 | 0.9979 | 0.7521 | 0/88 | 12/110 | 0 | 0 | 0 | 20 | 3 | yes | fail | — | — | — | — | — |
| psf-2026-proletno-8 | model-adjudicated | agent/sonnet | 3/3, 0, 0 | 1 | 0.9985 | 0/4 | 2/0 | 0 | 0 | 0 | 1 | 0 | yes | pass | — | — | — | — | — |
| psf-2026-proletno-8 | model-adjudicated | zai/glm-5.3-flash | 3/3, 0, 0 | 0.9927 | 0.9005 | 2/3 | 5/108 | 0 | -1 | 0 | 13 | 3 | yes | fail | — | 0.008588 | — | — | 156 |

Columns: *valid* = validate.mjs exit 0; *checker* = recorded verdict, not a guarantee of quality; *receipt* = receipt.json verdict for these bytes; *total $* = recorded reader + checks bound to this candidate, shown only with complete recorded costs and no unpriced failed attempts; *accepted $* requires a passed receipt. Agent subscription usage is unpriced. Dollar figures are list-price equivalents, not invoices. LaTeX ≠ counts normalised math spans present on one side only; these are review signals, not adjudicated errors.

## Per-problem detail

### psf-2025-proletno-10 — agent/haiku

- problem 1: stmt 0.969; sol 0.9586; missing numbers: 0.8kg 0.1kg 10m/s^2 10m/s^2 6N/C; extra numbers: 0.8 0.1 10 10 6; LaTeX ≠ −m_{л}=0,8kg −m_{д}=0,1kg −g\approx10m/s^2 −g\approx10m/s^2 −E=10^6N/C −2N; solution LaTeX ≠ 21/21; answers ≠ а), б), а), б), в); points ≠
- problem 2: stmt 0.9667; sol 0.9821; missing numbers: 150N/C 4mC 2m/s 1m 10m/s^2 3т; extra numbers: 150 4 2 1 10; LaTeX ≠ −E\approx150N/C −q=4mC −v=2m/s −s=1m −g\approx10m/s^2 −\varkappa; solution LaTeX ≠ 15/15; answers ≠ Част I, а), б); points ≠
- problem 3: stmt 0.9026; sol 0.9667; missing numbers: 12V 60mW 6.5т 3.5т; extra numbers: 12 60; LaTeX ≠ −R_1=100\Omega −R_2=R_3=200\Omega −\mathcal{E}=12V −P_x=60mW −R=20\Omega +R_1=100; solution LaTeX ≠ 10/10; answers ≠ Част I, Част II; points ≠

### psf-2025-proletno-10 — agent/sonnet

- problem 1: stmt 0.957; sol 0.9913; missing numbers: 6N/C; extra numbers: 6; answers ≠ а), б), а), б), в)
- problem 2: stmt 0.9762; sol 0.9923; missing numbers: 3т; answers ≠ Част I, а), б)
- problem 3: stmt 0.9592; sol 0.9833; missing numbers: 6.5т 3.5т; answers ≠ Част I

### psf-2025-proletno-10 — zai/glm-5.3-flash

- problem 1: stmt 0.9704; sol 0.9966; solution LaTeX ≠ 1/1; answers ≠ а), б), а), б), в); points ≠
- problem 2: stmt 0.9857; sol 0.9949; solution LaTeX ≠ 3/3; answers ≠ а), б); points ≠
- problem 3: stmt 0.99; sol 0.9918; solution LaTeX ≠ 2/2; points ≠

### psf-2024-proletno-9 — agent/haiku

- problem 1: stmt 0.825; sol 0.9895; missing numbers: 1.1 1.2Два 0; extra numbers: 1.2 1.2; LaTeX ≠ −p_0=const −g −\rho +A +A +B; solution LaTeX ≠ 1/1; answers ≠ 1.1, А., Б.; points ≠; parts Δ-1
- problem 2: stmt 0.994; sol 0.9834; extra numbers: 3т; LaTeX ≠ −\mathcal{E} −\mathcal{E} +\varepsilon +\varepsilon; solution LaTeX ≠ 12/15; answers ≠ А., Б., В.; points ≠
- problem 3: stmt 0.9919; sol 0.9863; missing numbers: 3.1; solution LaTeX ≠ 3/3; answers ≠ 3.1, 3.2; points ≠

### psf-2024-proletno-9 — agent/sonnet

- problem 1: stmt 0.9948; sol 1; missing numbers: 1.1
- problem 2: stmt 1; sol 1
- problem 3: stmt 0.9945; sol 1; missing numbers: 3.1

### psf-2024-proletno-9 — zai/glm-5.3-flash

- problem 1: stmt 0.9771; sol 0.9787; missing numbers: 1.1; extra numbers: 3т 3т 4т; solution LaTeX ≠ 2/2; answers ≠ 1.1, А., Б.; parts Δ1
- problem 2: stmt 0.994; sol 0.983; extra numbers: 3т; LaTeX ≠ −\mathcal{E} −\mathcal{E} +\mathscr{E} +\mathscr{E}; solution LaTeX ≠ 12/11; answers ≠ А., Б., В.
- problem 3: stmt 0.9617; sol 0.9564; missing numbers: 3.1 1; LaTeX ≠ −t_1 +t; solution LaTeX ≠ 7/7; answers ≠ 3.1, 3.2

### nof-2024-ii-11 — agent/haiku

- problem 1: stmt 0.3075; sol 0.7609; missing numbers: 9.8m/s^2 0 0до 90° 0.0000 0.0000 0.0000 1.0000 1.0000 1.0000 30 30 0.5000 0.5000 0.5000 0.5000 0.8660 0.8660 0.8660 0.8660 0.5774 0.5774 60 60 1.7321 1.7321 1 0.0175 0.0175 0.0175 0.9998 0.9998 31 0.5150 0.5150 0.8572 0.8572 0.6009 61 0.8746 0.8746 0.4848 0.4848 1.8040 2 0.0349 0.0349 0.0349 0.9994 0.9994 32 0.5299 0.5299 0.8480 0.8480 0.6249 62 0.8829 0.8829 0.4695 0.4695 1.8807 3 0.0523 0.0523 0.9986 0.9986 0.0524 33 0.5446 0.5446 0.8387 0.8387 0.6494 63 0.8910 0.8910 0.4540 0.4540 1.9626 4 0.0698 0.0698 0.9976 0.9976 0.0699 34 0.5592 0.5592 0.8290 0.8290 0.6745 64 0.8988 0.8988 0.4384 0.4384 2.0503 5 0.0872 0.0872 0.9962 0.9962 0.0875 35 0.5736 0.5736 0.8192 0.8192 0.7002 65 0.9063 0.9063 0.4226 0.4226 2.1445 6 0.1045 0.1045 0.9945 0.9945 0.1051 36 0.5878 0.5878 0.8090 0.8090 0.7265 66 0.9135 0.9135 0.4067 0.4067 2.2460 7 0.1219 0.1219 0.9925 0.9925 0.1228 37 0.6018 0.6018 0.7986 0.7986 0.7536 67 0.9205 0.9205 0.3907 0.3907 2.3559 8 0.1392 0.1392 0.9903 0.9903 0.1405 38 0.6157 0.6157 0.7880 0.7880 0.7813 68 0.9272 0.9272 0.3746 0.3746 2.4751 9 0.1564 0.1564 0.9877 0.9877 0.1584 39 0.6293 0.6293 0.7771 0.7771 0.8098 69 0.9336 0.9336 0.3584 0.3584 2.6051 10 0.1736 0.1736 0.9848 0.9848 0.1763 40 0.6428 0.6428 0.7660 0.7660 0.8391 70 0.9397 0.9397 0.3420 0.3420 2.7475 11 0.1908 0.1908 0.9816 0.9816 0.1944 41 0.6561 0.6561 0.7547 0.7547 0.8693 71 0.9455 0.9455 0.3256 0.3256 2.9042 12 0.2079 0.2079 0.9781 0.9781 0.2126 42 0.6691 0.6691 0.7431 0.7431 0.9004 72 0.9511 0.9511 0.3090 0.3090 3.0777 13 0.2250 0.2250 0.9744 0.9744 0.2309 43 0.6820 0.6820 0.7314 0.7314 0.9325 73 0.9563 0.9563 0.2924 0.2924 3.2709 14 0.2419 0.2419 0.9703 0.9703 0.2493 44 0.6947 0.6947 0.7193 0.7193 0.9657 74 0.9613 0.9613 0.2756 0.2756 3.4874 15 0.2588 0.2588 0.9659 0.9659 0.2679 45 0.7071 0.7071 75 3.7321 16 0.2867 46 1.0355 76 4.0108 17 0.3057 47 1.0724 77 4.3315 18 0.3249 48 1.1106 78 4.7046 19 0.3443 49 1.1504 79 5.1446 20 0.3640 50 1.1918 80 5.6713 21 0.3839 51 1.2349 81 6.3138 22 0.4040 52 1.2799 82 7.1154 23 0.4245 53 1.3270 83 8.1443 24 0.4452 54 1.3764 84 9.5144 25 0.4663 55 1.4281 85 11.4301 26 0.4877 56 1.4826 86 14.3007 27 0.5095 57 1.5399 87 19.0811 28 0.5317 58 1.6003 88 28.6363 29 0.5543 59 1.6643 89 57.2900 90; LaTeX ≠ −g=9,8m/s^2 −\vec{v}_0 −\vec{v} +\bar{v}_0 +\bar{v}; solution LaTeX ≠ 14/14; table cells ±384/0; answers ≠ а), б), в); points ≠
- problem 2: stmt 0.401; sol 0.7456; missing numbers: 9.8m/s^2 2 2 0 15° 3 3 0до 90° 0.0000 0.0000 0.0000 1.0000 1.0000 1.0000 30 30 0.5000 0.5000 0.5000 0.5000 0.8660 0.8660 0.8660 0.8660 0.5774 0.5774 60 60 1.7321 1.7321 1 0.0175 0.0175 0.0175 0.9998 0.9998 31 0.5150 0.5150 0.8572 0.8572 0.6009 61 0.8746 0.8746 0.4848 0.4848 1.8040 0.0349 0.0349 0.0349 0.9994 0.9994 32 0.5299 0.5299 0.8480 0.8480 0.6249 62 0.8829 0.8829 0.4695 0.4695 1.8807 0.0523 0.0523 0.9986 0.9986 0.0524 33 0.5446 0.5446 0.8387 0.8387 0.6494 63 0.8910 0.8910 0.4540 0.4540 1.9626 4 0.0698 0.0698 0.9976 0.9976 0.0699 34 0.5592 0.5592 0.8290 0.8290 0.6745 64 0.8988 0.8988 0.4384 0.4384 2.0503 5 0.0872 0.0872 0.9962 0.9962 0.0875 35 0.5736 0.5736 0.8192 0.8192 0.7002 65 0.9063 0.9063 0.4226 0.4226 2.1445 6 0.1045 0.1045 0.9945 0.9945 0.1051 36 0.5878 0.5878 0.8090 0.8090 0.7265 66 0.9135 0.9135 0.4067 0.4067 2.2460 7 0.1219 0.1219 0.9925 0.9925 0.1228 37 0.6018 0.6018 0.7986 0.7986 0.7536 67 0.9205 0.9205 0.3907 0.3907 2.3559 8 0.1392 0.1392 0.9903 0.9903 0.1405 38 0.6157 0.6157 0.7880 0.7880 0.7813 68 0.9272 0.9272 0.3746 0.3746 2.4751 9 0.1564 0.1564 0.9877 0.9877 0.1584 39 0.6293 0.6293 0.7771 0.7771 0.8098 69 0.9336 0.9336 0.3584 0.3584 2.6051 10 0.1736 0.1736 0.9848 0.9848 0.1763 40 0.6428 0.6428 0.7660 0.7660 0.8391 70 0.9397 0.9397 0.3420 0.3420 2.7475 11 0.1908 0.1908 0.9816 0.9816 0.1944 41 0.6561 0.6561 0.7547 0.7547 0.8693 71 0.9455 0.9455 0.3256 0.3256 2.9042 12 0.2079 0.2079 0.9781 0.9781 0.2126 42 0.6691 0.6691 0.7431 0.7431 0.9004 72 0.9511 0.9511 0.3090 0.3090 3.0777 13 0.2250 0.2250 0.9744 0.9744 0.2309 43 0.6820 0.6820 0.7314 0.7314 0.9325 73 0.9563 0.9563 0.2924 0.2924 3.2709 14 0.2419 0.2419 0.9703 0.9703 0.2493 44 0.6947 0.6947 0.7193 0.7193 0.9657 74 0.9613 0.9613 0.2756 0.2756 3.4874 0.2588 0.2588 0.9659 0.9659 0.2679 45 0.7071 0.7071 75 3.7321 16 0.2867 46 1.0355 76 4.0108 17 0.3057 47 1.0724 77 4.3315 18 0.3249 48 1.1106 78 4.7046 19 0.3443 49 1.1504 79 5.1446 20 0.3640 50 1.1918 80 5.6713 21 0.3839 51 1.2349 81 6.3138 22 0.4040 52 1.2799 82 7.1154 23 0.4245 53 1.3270 83 8.1443 24 0.4452 54 1.3764 84 9.5144 25 0.4663 55 1.4281 85 11.4301 26 0.4877 56 1.4826 86 14.3007 27 0.5095 57 1.5399 87 19.0811 28 0.5317 58 1.6003 88 28.6363 29 0.5543 59 1.6643 89 57.2900 90; LaTeX ≠ −g=9,8m/s^2 −O −C −\theta_max=15° −I=M\ell^2/3 −M,\ell,m; solution LaTeX ≠ 11/13; table cells ±384/0; answers ≠ а), б), в); points ≠
- problem 3: stmt 0.9585; sol 0.6969; missing numbers: 1.0т 1.0т 3.5т; LaTeX ≠ −O −O −OO'; solution LaTeX ≠ 21/15; answers ≠ а), б); points ≠

### nof-2024-ii-11 — agent/sonnet

- problem 1: stmt 0.3349; sol 0.9276; missing numbers: 9.8m/s^2 0 0до 90° 0.0000 0.0000 0.0000 1.0000 1.0000 1.0000 30 30 0.5000 0.5000 0.5000 0.5000 0.8660 0.8660 0.8660 0.8660 0.5774 0.5774 60 60 1.7321 1.7321 1 0.0175 0.0175 0.0175 0.9998 0.9998 31 0.5150 0.5150 0.8572 0.8572 0.6009 61 0.8746 0.8746 0.4848 0.4848 1.8040 2 0.0349 0.0349 0.0349 0.9994 0.9994 32 0.5299 0.5299 0.8480 0.8480 0.6249 62 0.8829 0.8829 0.4695 0.4695 1.8807 3 0.0523 0.0523 0.9986 0.9986 0.0524 33 0.5446 0.5446 0.8387 0.8387 0.6494 63 0.8910 0.8910 0.4540 0.4540 1.9626 4 0.0698 0.0698 0.9976 0.9976 0.0699 34 0.5592 0.5592 0.8290 0.8290 0.6745 64 0.8988 0.8988 0.4384 0.4384 2.0503 5 0.0872 0.0872 0.9962 0.9962 0.0875 35 0.5736 0.5736 0.8192 0.8192 0.7002 65 0.9063 0.9063 0.4226 0.4226 2.1445 6 0.1045 0.1045 0.9945 0.9945 0.1051 36 0.5878 0.5878 0.8090 0.8090 0.7265 66 0.9135 0.9135 0.4067 0.4067 2.2460 7 0.1219 0.1219 0.9925 0.9925 0.1228 37 0.6018 0.6018 0.7986 0.7986 0.7536 67 0.9205 0.9205 0.3907 0.3907 2.3559 8 0.1392 0.1392 0.9903 0.9903 0.1405 38 0.6157 0.6157 0.7880 0.7880 0.7813 68 0.9272 0.9272 0.3746 0.3746 2.4751 9 0.1564 0.1564 0.9877 0.9877 0.1584 39 0.6293 0.6293 0.7771 0.7771 0.8098 69 0.9336 0.9336 0.3584 0.3584 2.6051 10 0.1736 0.1736 0.9848 0.9848 0.1763 40 0.6428 0.6428 0.7660 0.7660 0.8391 70 0.9397 0.9397 0.3420 0.3420 2.7475 11 0.1908 0.1908 0.9816 0.9816 0.1944 41 0.6561 0.6561 0.7547 0.7547 0.8693 71 0.9455 0.9455 0.3256 0.3256 2.9042 12 0.2079 0.2079 0.9781 0.9781 0.2126 42 0.6691 0.6691 0.7431 0.7431 0.9004 72 0.9511 0.9511 0.3090 0.3090 3.0777 13 0.2250 0.2250 0.9744 0.9744 0.2309 43 0.6820 0.6820 0.7314 0.7314 0.9325 73 0.9563 0.9563 0.2924 0.2924 3.2709 14 0.2419 0.2419 0.9703 0.9703 0.2493 44 0.6947 0.6947 0.7193 0.7193 0.9657 74 0.9613 0.9613 0.2756 0.2756 3.4874 15 0.2588 0.2588 0.9659 0.9659 0.2679 45 0.7071 0.7071 75 3.7321 16 0.2867 46 1.0355 76 4.0108 17 0.3057 47 1.0724 77 4.3315 18 0.3249 48 1.1106 78 4.7046 19 0.3443 49 1.1504 79 5.1446 20 0.3640 50 1.1918 80 5.6713 21 0.3839 51 1.2349 81 6.3138 22 0.4040 52 1.2799 82 7.1154 23 0.4245 53 1.3270 83 8.1443 24 0.4452 54 1.3764 84 9.5144 25 0.4663 55 1.4281 85 11.4301 26 0.4877 56 1.4826 86 14.3007 27 0.5095 57 1.5399 87 19.0811 28 0.5317 58 1.6003 88 28.6363 29 0.5543 59 1.6643 89 57.2900 90; LaTeX ≠ −g=9,8m/s^2; table cells ±384/0; points ≠
- problem 2: stmt 0.4503; sol 0.9483; missing numbers: 9.8m/s^2 2 0 3 0до 90° 0.0000 0.0000 0.0000 1.0000 1.0000 1.0000 30 30 0.5000 0.5000 0.5000 0.5000 0.8660 0.8660 0.8660 0.8660 0.5774 0.5774 60 60 1.7321 1.7321 1 0.0175 0.0175 0.0175 0.9998 0.9998 31 0.5150 0.5150 0.8572 0.8572 0.6009 61 0.8746 0.8746 0.4848 0.4848 1.8040 0.0349 0.0349 0.0349 0.9994 0.9994 32 0.5299 0.5299 0.8480 0.8480 0.6249 62 0.8829 0.8829 0.4695 0.4695 1.8807 0.0523 0.0523 0.9986 0.9986 0.0524 33 0.5446 0.5446 0.8387 0.8387 0.6494 63 0.8910 0.8910 0.4540 0.4540 1.9626 4 0.0698 0.0698 0.9976 0.9976 0.0699 34 0.5592 0.5592 0.8290 0.8290 0.6745 64 0.8988 0.8988 0.4384 0.4384 2.0503 5 0.0872 0.0872 0.9962 0.9962 0.0875 35 0.5736 0.5736 0.8192 0.8192 0.7002 65 0.9063 0.9063 0.4226 0.4226 2.1445 6 0.1045 0.1045 0.9945 0.9945 0.1051 36 0.5878 0.5878 0.8090 0.8090 0.7265 66 0.9135 0.9135 0.4067 0.4067 2.2460 7 0.1219 0.1219 0.9925 0.9925 0.1228 37 0.6018 0.6018 0.7986 0.7986 0.7536 67 0.9205 0.9205 0.3907 0.3907 2.3559 8 0.1392 0.1392 0.9903 0.9903 0.1405 38 0.6157 0.6157 0.7880 0.7880 0.7813 68 0.9272 0.9272 0.3746 0.3746 2.4751 9 0.1564 0.1564 0.9877 0.9877 0.1584 39 0.6293 0.6293 0.7771 0.7771 0.8098 69 0.9336 0.9336 0.3584 0.3584 2.6051 10 0.1736 0.1736 0.9848 0.9848 0.1763 40 0.6428 0.6428 0.7660 0.7660 0.8391 70 0.9397 0.9397 0.3420 0.3420 2.7475 11 0.1908 0.1908 0.9816 0.9816 0.1944 41 0.6561 0.6561 0.7547 0.7547 0.8693 71 0.9455 0.9455 0.3256 0.3256 2.9042 12 0.2079 0.2079 0.9781 0.9781 0.2126 42 0.6691 0.6691 0.7431 0.7431 0.9004 72 0.9511 0.9511 0.3090 0.3090 3.0777 13 0.2250 0.2250 0.9744 0.9744 0.2309 43 0.6820 0.6820 0.7314 0.7314 0.9325 73 0.9563 0.9563 0.2924 0.2924 3.2709 14 0.2419 0.2419 0.9703 0.9703 0.2493 44 0.6947 0.6947 0.7193 0.7193 0.9657 74 0.9613 0.9613 0.2756 0.2756 3.4874 15 0.2588 0.2588 0.9659 0.9659 0.2679 45 0.7071 0.7071 75 3.7321 16 0.2867 46 1.0355 76 4.0108 17 0.3057 47 1.0724 77 4.3315 18 0.3249 48 1.1106 78 4.7046 19 0.3443 49 1.1504 79 5.1446 20 0.3640 50 1.1918 80 5.6713 21 0.3839 51 1.2349 81 6.3138 22 0.4040 52 1.2799 82 7.1154 23 0.4245 53 1.3270 83 8.1443 24 0.4452 54 1.3764 84 9.5144 25 0.4663 55 1.4281 85 11.4301 26 0.4877 56 1.4826 86 14.3007 27 0.5095 57 1.5399 87 19.0811 28 0.5317 58 1.6003 88 28.6363 29 0.5543 59 1.6643 89 57.2900 90; LaTeX ≠ −g=9,8m/s^2; table cells ±384/0; points ≠
- problem 3: stmt 1; sol 0.9531; LaTeX ≠ −T; solution LaTeX ≠ 1/1; points ≠

### nof-2024-ii-11 — zai/glm-5.3-flash

- problem 1: stmt 0.2951; sol 0.866; missing numbers: 0 0до 90° 0.0000 0.0000 0.0000 1.0000 1.0000 1.0000 30 30 0.5000 0.5000 0.5000 0.5000 0.8660 0.8660 0.8660 0.8660 0.5774 0.5774 60 60 1.7321 1.7321 1 0.0175 0.0175 0.0175 0.9998 0.9998 31 0.5150 0.5150 0.8572 0.8572 0.6009 61 0.8746 0.8746 0.4848 0.4848 1.8040 2 0.0349 0.0349 0.0349 0.9994 0.9994 32 0.5299 0.5299 0.8480 0.8480 0.6249 62 0.8829 0.8829 0.4695 0.4695 1.8807 3 0.0523 0.0523 0.9986 0.9986 0.0524 33 0.5446 0.5446 0.8387 0.8387 0.6494 63 0.8910 0.8910 0.4540 0.4540 1.9626 4 0.0698 0.0698 0.9976 0.9976 0.0699 34 0.5592 0.5592 0.8290 0.8290 0.6745 64 0.8988 0.8988 0.4384 0.4384 2.0503 5 0.0872 0.0872 0.9962 0.9962 0.0875 35 0.5736 0.5736 0.8192 0.8192 0.7002 65 0.9063 0.9063 0.4226 0.4226 2.1445 6 0.1045 0.1045 0.9945 0.9945 0.1051 36 0.5878 0.5878 0.8090 0.8090 0.7265 66 0.9135 0.9135 0.4067 0.4067 2.2460 7 0.1219 0.1219 0.9925 0.9925 0.1228 37 0.6018 0.6018 0.7986 0.7986 0.7536 67 0.9205 0.9205 0.3907 0.3907 2.3559 8 0.1392 0.1392 0.9903 0.9903 0.1405 38 0.6157 0.6157 0.7880 0.7880 0.7813 68 0.9272 0.9272 0.3746 0.3746 2.4751 9 0.1564 0.1564 0.9877 0.9877 0.1584 39 0.6293 0.6293 0.7771 0.7771 0.8098 69 0.9336 0.9336 0.3584 0.3584 2.6051 10 0.1736 0.1736 0.9848 0.9848 0.1763 40 0.6428 0.6428 0.7660 0.7660 0.8391 70 0.9397 0.9397 0.3420 0.3420 2.7475 11 0.1908 0.1908 0.9816 0.9816 0.1944 41 0.6561 0.6561 0.7547 0.7547 0.8693 71 0.9455 0.9455 0.3256 0.3256 2.9042 12 0.2079 0.2079 0.9781 0.9781 0.2126 42 0.6691 0.6691 0.7431 0.7431 0.9004 72 0.9511 0.9511 0.3090 0.3090 3.0777 13 0.2250 0.2250 0.9744 0.9744 0.2309 43 0.6820 0.6820 0.7314 0.7314 0.9325 73 0.9563 0.9563 0.2924 0.2924 3.2709 14 0.2419 0.2419 0.9703 0.9703 0.2493 44 0.6947 0.6947 0.7193 0.7193 0.9657 74 0.9613 0.9613 0.2756 0.2756 3.4874 15 0.2588 0.2588 0.9659 0.9659 0.2679 45 0.7071 0.7071 75 3.7321 16 0.2867 46 1.0355 76 4.0108 17 0.3057 47 1.0724 77 4.3315 18 0.3249 48 1.1106 78 4.7046 19 0.3443 49 1.1504 79 5.1446 20 0.3640 50 1.1918 80 5.6713 21 0.3839 51 1.2349 81 6.3138 22 0.4040 52 1.2799 82 7.1154 23 0.4245 53 1.3270 83 8.1443 24 0.4452 54 1.3764 84 9.5144 25 0.4663 55 1.4281 85 11.4301 26 0.4877 56 1.4826 86 14.3007 27 0.5095 57 1.5399 87 19.0811 28 0.5317 58 1.6003 88 28.6363 29 0.5543 59 1.6643 89 57.2900 90; solution LaTeX ≠ 14/14; table cells ±384/0; points ≠
- problem 2: stmt 0.433; sol 0.8877; missing numbers: 9.8m/s^2 2 0 15° 3 0до 90° 0.0000 0.0000 0.0000 1.0000 1.0000 1.0000 30 30 0.5000 0.5000 0.5000 0.5000 0.8660 0.8660 0.8660 0.8660 0.5774 0.5774 60 60 1.7321 1.7321 1 0.0175 0.0175 0.0175 0.9998 0.9998 31 0.5150 0.5150 0.8572 0.8572 0.6009 61 0.8746 0.8746 0.4848 0.4848 1.8040 0.0349 0.0349 0.0349 0.9994 0.9994 32 0.5299 0.5299 0.8480 0.8480 0.6249 62 0.8829 0.8829 0.4695 0.4695 1.8807 0.0523 0.0523 0.9986 0.9986 0.0524 33 0.5446 0.5446 0.8387 0.8387 0.6494 63 0.8910 0.8910 0.4540 0.4540 1.9626 4 0.0698 0.0698 0.9976 0.9976 0.0699 34 0.5592 0.5592 0.8290 0.8290 0.6745 64 0.8988 0.8988 0.4384 0.4384 2.0503 5 0.0872 0.0872 0.9962 0.9962 0.0875 35 0.5736 0.5736 0.8192 0.8192 0.7002 65 0.9063 0.9063 0.4226 0.4226 2.1445 6 0.1045 0.1045 0.9945 0.9945 0.1051 36 0.5878 0.5878 0.8090 0.8090 0.7265 66 0.9135 0.9135 0.4067 0.4067 2.2460 7 0.1219 0.1219 0.9925 0.9925 0.1228 37 0.6018 0.6018 0.7986 0.7986 0.7536 67 0.9205 0.9205 0.3907 0.3907 2.3559 8 0.1392 0.1392 0.9903 0.9903 0.1405 38 0.6157 0.6157 0.7880 0.7880 0.7813 68 0.9272 0.9272 0.3746 0.3746 2.4751 9 0.1564 0.1564 0.9877 0.9877 0.1584 39 0.6293 0.6293 0.7771 0.7771 0.8098 69 0.9336 0.9336 0.3584 0.3584 2.6051 10 0.1736 0.1736 0.9848 0.9848 0.1763 40 0.6428 0.6428 0.7660 0.7660 0.8391 70 0.9397 0.9397 0.3420 0.3420 2.7475 11 0.1908 0.1908 0.9816 0.9816 0.1944 41 0.6561 0.6561 0.7547 0.7547 0.8693 71 0.9455 0.9455 0.3256 0.3256 2.9042 12 0.2079 0.2079 0.9781 0.9781 0.2126 42 0.6691 0.6691 0.7431 0.7431 0.9004 72 0.9511 0.9511 0.3090 0.3090 3.0777 13 0.2250 0.2250 0.9744 0.9744 0.2309 43 0.6820 0.6820 0.7314 0.7314 0.9325 73 0.9563 0.9563 0.2924 0.2924 3.2709 14 0.2419 0.2419 0.9703 0.9703 0.2493 44 0.6947 0.6947 0.7193 0.7193 0.9657 74 0.9613 0.9613 0.2756 0.2756 3.4874 0.2588 0.2588 0.9659 0.9659 0.2679 45 0.7071 0.7071 75 3.7321 16 0.2867 46 1.0355 76 4.0108 17 0.3057 47 1.0724 77 4.3315 18 0.3249 48 1.1106 78 4.7046 19 0.3443 49 1.1504 79 5.1446 20 0.3640 50 1.1918 80 5.6713 21 0.3839 51 1.2349 81 6.3138 22 0.4040 52 1.2799 82 7.1154 23 0.4245 53 1.3270 83 8.1443 24 0.4452 54 1.3764 84 9.5144 25 0.4663 55 1.4281 85 11.4301 26 0.4877 56 1.4826 86 14.3007 27 0.5095 57 1.5399 87 19.0811 28 0.5317 58 1.6003 88 28.6363 29 0.5543 59 1.6643 89 57.2900 90; LaTeX ≠ −g=9,8m/s^2 −O −C −\theta_max=15° −M −\ell; solution LaTeX ≠ 11/11; table cells ±384/0; answers ≠ а), б); points ≠
- problem 3: stmt 0.9874; sol 0.9131; solution LaTeX ≠ 13/12; answers ≠ а), б); points ≠

### psf-2006-proletno-sp — agent/haiku

- problem 1: stmt 0.7531; sol 0.6556; missing numbers: 3 0; extra numbers: 10; LaTeX ≠ −M −L −\mu −T −x −(1)\qquady(x,t)=A\sin(kx)\sin(\omegat),; solution LaTeX ≠ 32/12; table cells ±32/0; answers ≠ а), б), в); points ≠
- problem 2: stmt 0.8336; sol 0.4153; missing numbers: 1 4 3 3 0 0 0 0 0 0 0 -7 2 2 2 1.60 -19 6.64 -34 4т 2т 2т 8a^5; extra numbers: 10; LaTeX ≠ −g −(1)\qquad\vec{B}=\frac{\mu_0g}{4\pir^3}\vec{r}, −\mu_0=4\pi*10^{-7}H/m −\mu_0=4\pi*10^{-7}H/m −(2)\qquad\Phi_B=\mu_0g_t, −\Phi_B; solution LaTeX ≠ 37/19; answers ≠ а), б), в); points ≠
- problem 3: stmt 0.846; sol 0.467; missing numbers: 1 1 1 1 1 0.84 0.84 0.023 2 2 2 2 2 2 20 20 20 0 0 0 3 3т 10° 1т; extra numbers: 20C 20C 20C 0C 0C 0C 10C; LaTeX ≠ −\Deltax −S −T −T+\DeltaT −t −Q; solution LaTeX ≠ 25/11; table cells ±8/0; answers ≠ а), б), в); points ≠

### psf-2006-proletno-sp — agent/sonnet

- problem 1: stmt 1; sol 0.9674; points ≠
- problem 2: stmt 0.9985; sol 0.9783; solution LaTeX ≠ 1/1; answers ≠ в); points ≠
- problem 3: stmt 1; sol 0.9926; answers ≠ в); points ≠

### psf-2006-proletno-sp — zai/glm-5.3-flash

- problem 1: stmt 0.852; sol 0.8525; missing numbers: 1 2 3; LaTeX ≠ −(1)\qquady(x,t)=A\sin(kx)\sin(\omegat), −c −(3)\qquadc=\sqrt{\frac{T}{\mu}}. −A,k,L,T −(2)\qquadcotg(kL)=\frac{Mk}{\mu}. +L; solution LaTeX ≠ 14/14; table cells ±29/29; answers ≠ а), б); points ≠
- problem 2: stmt 0.9159; sol 0.9803; missing numbers: 1 1 4 3 3 0 0 0 0 -7 2 2 2 2 1.60 -19 6.64 -34 4т 8a^5; LaTeX ≠ −(1)\qquad\vec{B}=\frac{\mu_0g}{4\pir^3}\vec{r}, −\mu_0=4\pi*10^{-7}H/m −(2)\qquad\Phi_B=\mu_0g_t, −e=1,60*10^{-19}C −h=6,64*10^{-34}J*s −\Omega; solution LaTeX ≠ 23/23; answers ≠ а), б), в); points ≠
- problem 3: stmt 0.9794; sol 0.9779; missing numbers: 1 10°; extra numbers: -1 -1 10; LaTeX ≠ −(1)\qquadQ=kS\frac{\DeltaT}{\Deltax}t, +Q=kS\frac{\DeltaT}{\Deltax}t, +k(W*m^{-1*K^{-1}}) +10^{\circ}C; solution LaTeX ≠ 15/15; table cells ±1/1; answers ≠ в); points ≠

### esf-2010-esenno-7 — agent/haiku

- problem 1: stmt 0.5501; sol 0.7556; missing numbers: 1 1 2 1б 1б 1б 2в 2в 2в 3г 0° 4° 20° 1g/cm^3 20hPa 2kPa 2N/cm^2; LaTeX ≠ −1g/cm^3 −2N/cm^2; answers ≠ 2., 3.
- problem 2: stmt 0.9247; sol 0.4255; missing numbers: 2 10 22 180 200; extra numbers: 10min 22s 180g 2N 200Pa; LaTeX ≠ −t_{к} −t=10 −t=22 −m=180 −F_{A1}=2 −p=200; solution LaTeX ≠ 10/0; answers ≠ 7.
- problem 3: stmt 0.8855; sol 0.1232; missing numbers: 22 22 13 13 15 15 20 20; extra numbers: 2 22m 22m 13m 13m 15m/s 15m/s 20m/s 20m/s; LaTeX ≠ −\ell_1=22 −\ell_1=22 −\ell_2=13 −\ell_2=13 −v_1=15 −v_1=15; solution LaTeX ≠ 16/7; answers ≠ б)

### esf-2010-esenno-7 — agent/sonnet

- problem 1: stmt 1; sol 1
- problem 2: stmt 1; sol 1; LaTeX ≠ −t_{к} +t_к; solution LaTeX ≠ 1/1; answers ≠ 7.
- problem 3: stmt 1; sol 1

### esf-2010-esenno-7 — zai/glm-5.3-flash

- problem 1: stmt 0.5894; sol 0.4; missing numbers: 1 1 2 1б 1б 1б 2в 2в 2в 3г 0° 4° 20° 1g/cm^3 20hPa 2kPa 2N/cm^2; LaTeX ≠ −1g/cm^3 −2N/cm^2; answers ≠ 1., 2., 3., 4., 5., 6., 7., 8., 9., 10.; points ≠
- problem 2: stmt 0.9701; sol 0.0714; missing numbers: 2 10 22 180 200; extra numbers: 10min 22s 180g 2N 200Pa; LaTeX ≠ −t=10 −t=22 −m=180 −F_{A1}=2 −p=200 +t=10min; answers ≠ 6.; points ≠
- problem 3: stmt 0.938; sol 0.8847; missing numbers: 22 22 13 13 15 15 20 20; extra numbers: 22m 22m 13m 13m 15m/s 15m/s 20m/s 20m/s; LaTeX ≠ −\ell_1=22 −\ell_1=22 −\ell_2=13 −\ell_2=13 −v_1=15 −v_1=15; solution LaTeX ≠ 8/8; answers ≠ Част 1.

### esf-2002-esenno-st — agent/haiku

- problem 1: stmt 0.4821; sol 0.5263; missing numbers: 3 2; extra numbers: 8т; LaTeX ≠ −l −E −l=CE^{\frac{3}{2}}, −C −f −f; solution LaTeX ≠ 5/5; answers ≠ problem; points ≠; parts Δ2
- problem 2: stmt 0.3818; sol 0.5926; missing numbers: 10 -3 2 4; LaTeX ≠ −m=3,5g −r=1cm −v=5m/s −\bar{F} −\Deltat=10^{-3}s −x; solution LaTeX ≠ 7/6; answers ≠ problem; points ≠; parts Δ2
- problem 3: stmt 0.6111; sol 0.3846; missing numbers: 0 10m 10m/s^2; extra numbers: 25m 2.0m 10m/s²; LaTeX ≠ −v_0 −x=10m −g=10m/s^2; solution LaTeX ≠ 7/5; answers ≠ problem; points ≠
- problem 4: stmt 0.7104; sol 0.4789; missing numbers: 0; extra numbers: 2cm; LaTeX ≠ −\lambda −B −v −I −A −r_0; solution LaTeX ≠ 9/9; answers ≠ а), б)
- problem 5: stmt 0.1838; sol 0.322; missing numbers: 1 1 1 2 2 2 680Hz 340m/s 0.1rad 1%; LaTeX ≠ −M_1 −M_2 −d=20cm −\nu=680Hz −S −d; solution LaTeX ≠ 10/16; answers ≠ а), б); parts Δ-2

### esf-2002-esenno-st — agent/sonnet

- problem 1: stmt 1; sol 1
- problem 2: stmt 0.9885; sol 1; solution LaTeX ≠ 3/3
- problem 3: stmt 1; sol 0.9545; solution LaTeX ≠ 5/5; answers ≠ problem
- problem 4: stmt 1; sol 0.9643; solution LaTeX ≠ 2/2
- problem 5: stmt 0.9876; sol 0.9714; solution LaTeX ≠ 2/2
- problem 6: stmt 0.699; sol 1; missing numbers: 60; extra numbers: 60° 0 0 0 0 0 1 1 1 2 2 1.6 -19 9.1 -31 6.64 -34 3.00 8; LaTeX ≠ −\alpha=60^{\circ} +\alpha=60° +(x^n)'=nx^{n-1}; +(f(x)g(x))'=f'(x)g(x)+f(x)g'(x); +\varphi +|\varphi|\ll1; solution LaTeX ≠ 3/3

### esf-2002-esenno-st — zai/glm-5.3-flash

- problem 1: stmt 0.928; sol 0.6296; missing numbers: 3; extra numbers: 1 8т; LaTeX ≠ −l=CE^{\frac{3}{2}}, +l=CE^{1/2},; solution LaTeX ≠ 7/7; answers ≠ problem
- problem 2: stmt 0.9318; sol 0.8367; extra numbers: 7т; LaTeX ≠ −\bar{F} +F; solution LaTeX ≠ 6/6
- problem 3: stmt 0.7368; sol 0.2143; extra numbers: 10т; solution LaTeX ≠ 11/11; answers ≠ problem; parts Δ2
- problem 4: stmt 0.9681; sol 0.439; extra numbers: 6т 4т; solution LaTeX ≠ 10/10; answers ≠ а), б)
- problem 5: stmt 0.7308; sol 0.4167; extra numbers: 0.1rad 5т 1% 10т; LaTeX ≠ −\delta; solution LaTeX ≠ 11/11
- problem 6: stmt 0.9091; sol 0.5306; extra numbers: 10т; LaTeX ≠ −\alpha=60^{\circ} +\alpha=60^\circ; solution LaTeX ≠ 7/7

### nof-2009-iii — agent/haiku

- problem 1: stmt 0.772; sol 0.8008; missing numbers: 1 1 1 1 1 2 2 1t 1k; extra numbers: 1kΩ; LaTeX ≠ −AB −m=10g −L=10cm −k=20N/m −C −C; solution LaTeX ≠ 30/22; answers ≠ а), б), в), г); points ≠
- problem 2: stmt 0.7263; sol 0.5209; missing numbers: 1 1 1 2.26 0 0 1atm 5Pa 8.3 10 2 18 103; extra numbers: 103°; LaTeX ≠ −mol −T −T-\DeltaT −\frac{\DeltaT}{T}\ll1 −p −p-\Deltap; solution LaTeX ≠ 14/12; answers ≠ а), б), в), г); points ≠
- problem 3: stmt 0.4323; sol 0.008; missing numbers: 1 1 1 2 2 2 2 2 0 0 0 0 1c 1ч 2c 2ч 1.4580 0.00354 1.5046 0.00420 1.5220 0.00459 1.5690 0.00531 1.6700 0.00743 1.7280 0.01342; LaTeX ≠ −f −R_1 −R_2 −R_2 −n_0 −n>n_0; solution LaTeX ≠ 27/0; table cells ±70/0; answers ≠ а), б), в), г); points ≠
- problem 4: stmt 0.6176; sol 0.6225; missing numbers: 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -17 2.40 -28 3.00 8 1.60 -19 6.63 -34 1 1 2 2 2; extra numbers: 10; LaTeX ≠ −\pi^0 −\pi^0 −\pi^0 −\pi^0 −\pi^0 −\pi^0; solution LaTeX ≠ 20/6; answers ≠ а), б), в), г), д); points ≠

### nof-2009-iii — agent/sonnet

- problem 1: stmt 1; sol 0.9222
- problem 2: stmt 1; sol 1; missing numbers: 1; extra numbers: 1.10; LaTeX ≠ −p_0=1atm=1*10^5Pa +p_0=1atm=1,10*10^5Pa
- problem 3: stmt 1; sol 1; solution LaTeX ≠ 1/1; answers ≠ а)
- problem 4: stmt 1; sol 0.9358

### nof-2009-iii — zai/glm-5.3-flash

- problem 1: stmt 0.9562; sol 0.8889; missing numbers: 1; LaTeX ≠ −AB −I=\frac{1}{12}mL^2 −U_{max} +I=(l/12)ml^2 +U_{\max}; solution LaTeX ≠ 22/21; answers ≠ а), б), в); points ≠
- problem 2: stmt 0.9817; sol 0.8736; missing numbers: 2.26 0 5Pa 8.3 2 18; extra numbers: 2.26MJ/kg 5 8.3J 10m/s^2 18g/mol; LaTeX ≠ −mol −\lambda=2,26\frac{MJ{kg}} −p_0=1atm=1*10^5Pa −R=8,3\frac{J{mol*K}} −g=10\frac{m{s^2}} −\mu=18\frac{g{mol}}; solution LaTeX ≠ 10/10; table cells ±0/12; answers ≠ б), г); points ≠
- problem 3: stmt 0.8933; sol 0.7138; missing numbers: 1c 2c; extra numbers: 4т 4т 4т 3т 1с 2с; LaTeX ≠ −R_2 −x\llR_1 −\sin\alpha\approx\tan\alpha\approx\alpha −R_1=R_2 −n_в=1 −n_c; solution LaTeX ≠ 22/31; table cells ±56/56; answers ≠ а), б), в), г); points ≠
- problem 4: stmt 0.9933; sol 0.8894; missing numbers: 0 0 0 0 0; extra numbers: 10 10 10 10 10; LaTeX ≠ −\pi^0 −8,4*10^{-17}s −MeV −MeV +(\pi^0) +(8,4*10^{-17}s); solution LaTeX ≠ 15/15; answers ≠ в), д); points ≠

### nao-2008-iv-st-prak — agent/haiku

- problem 1: stmt 0.9651; sol 0.8533; missing numbers: 0; extra numbers: 10; solution LaTeX ≠ 9/19; answers ≠ problem
- problem 2: stmt 0.7075; sol 0.7001; missing numbers: 225Хенр -21 1 00h 00h 00h 00h 00h 00h 00h 00h 00h 00h 00h 00h 00h 00h 00h 00h 00h 00h 00h 00h 00h 00h 00h 00h 00h 00h 00h 00h 00m 00m 00m 00m 00m 00m 00m 00m 00m 00m 00m 00m 00m 00m 00m 00m 00m 00m 00m 00m 00m 00m 00m 00m 00m 00.0s 10.0s 2 30.4s 35.6s 38.7s 44.2s 3 27.8s 27.8s 32.5s 34.9s 39.7s 4 35.1s 44.8s 5 34.8s 36.4s 6 40.4s 43.8s 50.7s 53.8s 7 51.2s 01m 01m 01m 00.9s 8 51.4s 56.1s 01.6s 06.8s 9 30.9s 10 15.7s 25.3s; extra numbers: 225Хеир -21°; LaTeX ≠ −\delta=-21^{\circ}43'18'' −5.56'' −\mu=24,84''/h +\delta=-21°43'18" +5.56" +\mu=24.84"/h; solution LaTeX ≠ 7/14; table cells ±158/0; answers ≠ А), Б), В)

### nao-2008-iv-st-prak — agent/sonnet

- problem 1: stmt 1; sol 0.9967; solution LaTeX ≠ 1/1; answers ≠ problem
- problem 2: stmt 0.9393; sol 0.9916; solution LaTeX ≠ 1/1

### nao-2008-iv-st-prak — zai/glm-5.3-flash

- problem 1: stmt 0.9968; sol 0.9622; missing numbers: 2 30; extra numbers: 2x; LaTeX ≠ −2*10^{30}; solution LaTeX ≠ 10/2
- problem 2: stmt 0.9669; sol 0.9838; missing numbers: 56 19 43 6378km; extra numbers: 6 9 3; LaTeX ≠ −\delta=-21^{\circ}43'18'' −11.67^m −12.46^m −5.56'' +\delta=-21^\circ43'18'' +11,67^m; solution LaTeX ≠ 3/3; answers ≠ А), Б)

### nof-2015-i-8 — agent/haiku

- problem 1: stmt 0.875; sol 0.8581; missing numbers: 0.01; LaTeX ≠ −s; solution LaTeX ≠ 7/7; answers ≠ а)
- problem 2: stmt 0.6235; sol 0.9457; missing numbers: 10m/s^2; extra numbers: 1 10; LaTeX ≠ −g=10m/s^2 +t_1 +H +t +v +g=10; solution LaTeX ≠ 4/4
- problem 3: stmt 0.8686; sol 0.9255; missing numbers: 10m/s^2 1.6m/s^2; extra numbers: 1.6; LaTeX ≠ −g=10m/s^2 −a=1,6m/s^2 +a=1,6; solution LaTeX ≠ 1/1

### nof-2015-i-8 — agent/sonnet

- problem 1: stmt 0.9908; sol 1; LaTeX ≠ −s; answers ≠ а)
- problem 2: stmt 0.8854; sol 0.9922
- problem 3: stmt 1; sol 1

### nof-2015-i-8 — zai/glm-5.3-flash

- problem 1: stmt 1; sol 0.9864; solution LaTeX ≠ 10/9; answers ≠ а)
- problem 2: stmt 0.8797; sol 0.9845; missing numbers: 10m/s^2; extra numbers: 10 2; LaTeX ≠ −g=10m/s^2 +g=10 +^2; solution LaTeX ≠ 2/2
- problem 3: stmt 0.979; sol 1; missing numbers: 10m/s^2 1.6m/s^2; extra numbers: 10 2 2 1.6; LaTeX ≠ −g=10m/s^2 −a=1,6m/s^2 +g=10 +^2 +^2 +a=1,6

### nao-2023-ii-5-6 — agent/haiku

- problem 1: stmt 0.925; sol 0.8291
- problem 2: stmt 1; sol 0.9058
- problem 3: stmt 0.9672; sol 0.7586; answers ≠ А), Б)
- problem 4: stmt 0.9563; sol 0.9488; missing numbers: 60дъго; extra numbers: 60дълг; solution LaTeX ≠ 2/2; answers ≠ А), Б)
- problem 5: stmt 0.9615; sol 0.943; answers ≠ А), Б)

### nao-2023-ii-5-6 — agent/sonnet

- problem 1: stmt 1; sol 1
- problem 2: stmt 1; sol 1
- problem 3: stmt 1; sol 1; answers ≠ Б)
- problem 4: stmt 1; sol 1
- problem 5: stmt 1; sol 1

### nao-2023-ii-5-6 — zai/glm-5.3-flash

- problem 1: stmt 0.9176; sol 0.9872; extra numbers: 1зада
- problem 2: stmt 0.9254; sol 0.9884; extra numbers: 2зада
- problem 3: stmt 0.9811; sol 0.8942; extra numbers: 3зада; answers ≠ А), Б)
- problem 4: stmt 0.957; sol 0.9581; missing numbers: 60дъго; extra numbers: 4зада 60дълг; solution LaTeX ≠ 3/3; answers ≠ А), Б)
- problem 5: stmt 0.9717; sol 0.9948; extra numbers: 5зада

### nof-2024-iii-11-12 — agent/haiku

- problem 1: stmt 0.521; sol 0.6038; missing numbers: 9.81m -2 -2 -2 -2 6.67 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -11 3 -1 -1 -1 -1 -1 -1 -1 -1 -1 9.109 -31 1.673 -27 -27 -27 1.675 1.60 -19 9.00 9N 2 2 2 2 1 1 1 1 1 1 1 1 4 4 85 -12 -7 3.00 8m 6.63 -34 -34 1.05 1u 1.66 931.5MeV 8.31J 6.02 23 1.38 -23 1.097 7m^ 1rad 45; extra numbers: 45°; LaTeX ≠ −g=9,81m.s^{-2} −\gamma=6,67*10^{-11}m^3.kg^{-1.s^{-2}} −m_e=9,109*10^{-31}kg −m_p=1,673*10^{-27}kg −m_n=1,675*10^{-27}kg −e=1,60*10^{-19}C; solution LaTeX ≠ 47/0; table cells ±36/0; answers ≠ а), б), в); points ≠
- problem 2: stmt 0.7088; sol 0.2385; missing numbers: 9.81m -2 -2 -2 -2 6.67 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -11 3 -1 -1 -1 -1 -1 -1 -1 -1 -1 9.109 -31 1.673 -27 -27 -27 1.675 1.60 -19 9.00 9N 2 4 4 85 -12 -7 3.00 8m 6.63 -34 -34 1.05 1u 1.66 931.5MeV 8.31J 6.02 23 1.38 -23 1.097 7m^ 2.3; extra numbers: 2.5т; LaTeX ≠ −g=9,81m.s^{-2} −\gamma=6,67*10^{-11}m^3.kg^{-1.s^{-2}} −m_e=9,109*10^{-31}kg −m_p=1,673*10^{-27}kg −m_n=1,675*10^{-27}kg −e=1,60*10^{-19}C; solution LaTeX ≠ 66/0; table cells ±36/0; answers ≠ А. а), А. б), Б., В. а), В. б), Г. а), Г. б); points ≠; parts Δ3
- problem 3: stmt 0.6453; sol 0.6833; missing numbers: 9.81m -2 -2 -2 -2 6.67 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -11 3 -1 -1 -1 -1 -1 -1 -1 -1 -1 9.109 -31 1.673 -27 -27 -27 1.675 1.60 -19 9.00 9N 2 2 2 1 1 4 4 85 -12 -7 3.00 8m 6.63 -34 -34 -34 1.05 1.05 1u 1.66 931.5MeV 8.31J 6.02 23 1.38 -23 1.097 7m^; LaTeX ≠ −g=9,81m.s^{-2} −\gamma=6,67*10^{-11}m^3.kg^{-1.s^{-2}} −m_e=9,109*10^{-31}kg −m_p=1,673*10^{-27}kg −m_n=1,675*10^{-27}kg −e=1,60*10^{-19}C; solution LaTeX ≠ 38/0; table cells ±46/10; answers ≠ а), б), в), г), д), е); points ≠; parts Δ1
- problem 4: stmt 0.7636; sol 0.5823; missing numbers: 9.81m -2 -2 -2 -2 6.67 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -11 3 -1 -1 -1 -1 -1 -1 -1 -1 -1 9.109 -31 1.673 -27 -27 -27 1.675 1.60 -19 9.00 9N 2 2 2 2 2 2 1 1 1 1 1 4 4 85 -12 -7 3.00 8m 6.63 -34 -34 1.05 1u 1.66 931.5MeV 8.31J 6.02 23 1.38 -23 1.097 7m^ 1.5т 1.0т 1.0т 2.5т 2.5т 1.50 580nm 0.5т; extra numbers: 1и; LaTeX ≠ −g=9,81m.s^{-2} −\gamma=6,67*10^{-11}m^3.kg^{-1.s^{-2}} −m_e=9,109*10^{-31}kg −m_p=1,673*10^{-27}kg −m_n=1,675*10^{-27}kg −e=1,60*10^{-19}C; solution LaTeX ≠ 37/0; table cells ±36/0; answers ≠ а), б), в), г), д), е), ж), з), и); points ≠

### nof-2024-iii-11-12 — agent/sonnet

- problem 1: stmt 0.7534; sol 0.9315; missing numbers: 9.81m -2 -2 -2 -2 6.67 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -11 3 -1 -1 -1 -1 -1 -1 -1 -1 -1 9.109 -31 1.673 -27 -27 -27 1.675 1.60 -19 9.00 9N 2 2 1 4 4 85 -12 -7 3.00 8m 6.63 -34 -34 1.05 1u 1.66 931.5MeV 8.31J 6.02 23 1.38 -23 1.097 7m^; LaTeX ≠ −g=9,81m.s^{-2} −\gamma=6,67*10^{-11}m^3.kg^{-1.s^{-2}} −m_e=9,109*10^{-31}kg −m_p=1,673*10^{-27}kg −m_n=1,675*10^{-27}kg −e=1,60*10^{-19}C; table cells ±36/0
- problem 2: stmt 0.8855; sol 0.9965; missing numbers: 9.81m -2 -2 -2 -2 6.67 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -11 3 -1 -1 -1 -1 -1 -1 -1 -1 -1 9.109 -31 1.673 -27 -27 -27 1.675 1.60 -19 9.00 9N 2 2 1 4 4 85 -12 -7 3.00 8m 6.63 -34 -34 1.05 1u 1.66 931.5MeV 8.31J 6.02 23 1.38 -23 1.097 7m^; LaTeX ≠ −g=9,81m.s^{-2} −\gamma=6,67*10^{-11}m^3.kg^{-1.s^{-2}} −m_e=9,109*10^{-31}kg −m_p=1,673*10^{-27}kg −m_n=1,675*10^{-27}kg −e=1,60*10^{-19}C; solution LaTeX ≠ 1/1; table cells ±36/0; answers ≠ А. а), А. б), Б., В. а), В. б), Г. а), Г. б)
- problem 3: stmt 0.6813; sol 0.9164; missing numbers: 9.81m -2 -2 -2 -2 6.67 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -11 3 -1 -1 -1 -1 -1 -1 -1 -1 -1 9.109 -31 1.673 -27 -27 -27 1.675 1.60 -19 9.00 9N 2 2 1 4 4 85 -12 -7 3.00 8m 6.63 -34 -34 1.05 1u 1.66 931.5MeV 8.31J 6.02 23 1.38 -23 1.097 7m^; LaTeX ≠ −g=9,81m.s^{-2} −\gamma=6,67*10^{-11}m^3.kg^{-1.s^{-2}} −m_e=9,109*10^{-31}kg −m_p=1,673*10^{-27}kg −m_n=1,675*10^{-27}kg −e=1,60*10^{-19}C; table cells ±40/4
- problem 4: stmt 0.9447; sol 1; missing numbers: 9.81m -2 -2 -2 -2 6.67 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -11 3 -1 -1 -1 -1 -1 -1 -1 -1 -1 9.109 -31 1.673 -27 -27 -27 1.675 1.60 -19 9.00 9N 2 2 1 4 4 85 -12 -7 3.00 8m 6.63 -34 -34 1.05 1u 1.66 931.5MeV 8.31J 6.02 23 1.38 -23 1.097 7m^ 2.5т 0.5т; LaTeX ≠ −g=9,81m.s^{-2} −\gamma=6,67*10^{-11}m^3.kg^{-1.s^{-2}} −m_e=9,109*10^{-31}kg −m_p=1,673*10^{-27}kg −m_n=1,675*10^{-27}kg −e=1,60*10^{-19}C; solution LaTeX ≠ 1/1; table cells ±36/0

### nof-2024-iii-11-12 — zai/glm-5.3-flash

- problem 1: stmt 0.7534; sol 0.9861; missing numbers: 9.81m -2 -2 -2 -2 6.67 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -11 3 -1 -1 -1 -1 -1 -1 -1 -1 -1 9.109 -31 1.673 -27 -27 -27 1.675 1.60 -19 9.00 9N 2 2 1 4 4 85 -12 -7 3.00 8m 6.63 -34 -34 1.05 1u 1.66 931.5MeV 8.31J 6.02 23 1.38 -23 1.097 7m^; LaTeX ≠ −g=9,81m.s^{-2} −\gamma=6,67*10^{-11}m^3.kg^{-1.s^{-2}} −m_e=9,109*10^{-31}kg −m_p=1,673*10^{-27}kg −m_n=1,675*10^{-27}kg −e=1,60*10^{-19}C; solution LaTeX ≠ 3/3; table cells ±36/0; answers ≠ а), б), в); points ≠
- problem 2: stmt 0.8525; sol 0.9298; missing numbers: 9.81m -2 -2 -2 -2 6.67 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -11 3 -1 -1 -1 -1 -1 -1 -1 -1 -1 9.109 -31 1.673 -27 -27 -27 1.675 1.60 -19 9.00 9N 2 2 1 4 4 85 -12 -7 3.00 8m 6.63 -34 -34 1.05 1u 1.66 931.5MeV 8.31J 6.02 23 1.38 -23 1.097 7m^; LaTeX ≠ −g=9,81m.s^{-2} −\gamma=6,67*10^{-11}m^3.kg^{-1.s^{-2}} −m_e=9,109*10^{-31}kg −m_p=1,673*10^{-27}kg −m_n=1,675*10^{-27}kg −e=1,60*10^{-19}C; solution LaTeX ≠ 31/29; table cells ±36/0; answers ≠ Б., В. б), Г. б)
- problem 3: stmt 0.9008; sol 0.9549; missing numbers: 9.81m -2 -2 -2 -2 6.67 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -11 3 -1 -1 -1 -1 -1 -1 -1 -1 -1 9.109 -31 1.673 -27 -27 -27 1.675 1.60 -19 9.00 9N 2 2 1 4 4 85 -12 -7 3.00 8m 6.63 -34 -34 1.05 1u 1.66 931.5MeV 8.31J 6.02 23 1.38 -23 1.097 7m^; LaTeX ≠ −g=9,81m.s^{-2} −\gamma=6,67*10^{-11}m^3.kg^{-1.s^{-2}} −m_e=9,109*10^{-31}kg −m_p=1,673*10^{-27}kg −m_n=1,675*10^{-27}kg −e=1,60*10^{-19}C; solution LaTeX ≠ 26/26; table cells ±44/8; answers ≠ а), в), г), е); points ≠
- problem 4: stmt 0.5682; sol 0.9826; missing numbers: 9.81m -2 -2 -2 -2 6.67 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -11 -1 -1 -1 -1 -1 -1 -1 -1 -1 9.109 -31 1.673 -27 -27 -27 1.675 1.60 -19 9.00 9N 2 2 1 4 4 85 -12 -7 3.00 8m 6.63 -34 -34 1.05 1u 1.66 931.5MeV 8.31J 6.02 23 1.38 -23 1.097 7m^ 1.5т 1.0т 1.0т 2.5т 2.5т 0.5т; extra numbers: 3 3 1.50 580nm 50m; LaTeX ≠ −g=9,81m.s^{-2} −\gamma=6,67*10^{-11}m^3.kg^{-1.s^{-2}} −m_e=9,109*10^{-31}kg −m_p=1,673*10^{-27}kg −m_n=1,675*10^{-27}kg −e=1,60*10^{-19}C; solution LaTeX ≠ 6/6; table cells ±36/0; answers ≠ а), б), в), г), е), ж), з), и); points ≠; parts Δ3

### psf-2026-proletno-8 — agent/haiku

- problem 1: stmt 1; sol 0.8379; solution LaTeX ≠ 17/14; answers ≠ а), б), в), г), д), е), ж); points ≠
- problem 2: stmt 0.9936; sol 0.7139; LaTeX ≠ −v_о +v_o; solution LaTeX ≠ 21/19; answers ≠ а), б), в), г); points ≠
- problem 3: stmt 1; sol 0.7046; LaTeX ≠ −h_г=60cm −p_в −h_м=68cm −h_в=17cm −h_н +h_r=60cm; solution LaTeX ≠ 21/18; answers ≠ а), б), в), г), д), е), ж), з), и); points ≠

### psf-2026-proletno-8 — agent/sonnet

- problem 1: stmt 1; sol 1
- problem 2: stmt 1; sol 0.9955; LaTeX ≠ −v_о +v_o; answers ≠ а)
- problem 3: stmt 1; sol 1

### psf-2026-proletno-8 — zai/glm-5.3-flash

- problem 1: stmt 0.9965; sol 0.9577; solution LaTeX ≠ 16/20; answers ≠ а), б), в), г), д), е); points ≠
- problem 2: stmt 0.9851; sol 0.8596; LaTeX ≠ −v_о −t_B +v_o +t_Б; solution LaTeX ≠ 22/26; answers ≠ а), г); points ≠
- problem 3: stmt 0.9964; sol 0.8842; missing numbers: 30; extra numbers: 30°; LaTeX ≠ −30^{\circ}; solution LaTeX ≠ 12/12; answers ≠ а), б), г), д), и); points ≠

