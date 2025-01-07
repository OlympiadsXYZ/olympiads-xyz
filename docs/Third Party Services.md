# Third Party Services

The following is a list of third party services that Olympiads XYZ uses.

Note: This may be out of date. Current version is from 07.01.2025

## Olympiads XYZ

- Hosted on Vercel
  - Uses free tier and pay as you go plan (not very generous free tier, so an upgrade might be needed in the future, depending on the internet traffic)
  - Can be replaced with any other hosting service
- Firebase backend (pay-as-you-go plan, pretty generous free tier)
  - No easy replacement
  - Technically can function without Firebase -- user login wouldn't work,
    classes wouldn't work, but everything else will still work (including local
    progress tracking)
- Algolia for Search
  - Currently squeezing in free tier with some optimizations, but it's expected to not suffice in the long run. Otherwise pay as you go.
  - No easy replacement. Without this, module search + problems search won't
    work.
- GitHub LFS for storage of archive files
  - Basic plan - 5$/month
  - Can be replaced with any other storage service

## Discussion & Forum

- In development, currently using Github Discussions

## Domain Names

- https://olympiads-xyz-bg.vercel.app/ 
- Google Search Console
- Google Analytics

