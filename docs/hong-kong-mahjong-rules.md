# Hong Kong Mahjong Rules Assumptions

This document captures the implemented Hong Kong Mahjong assumptions used by the app. The attached cheat sheet is treated as the primary rules source; where operational details were not explicit, common Classical Hong Kong Mahjong behavior was used.

## Game shape

- Four players sit East, South, West, and North.
- A round has a dealer and a prevailing wind.
- The game uses a 144-tile set:
  - Characters 1-9, four copies each.
  - Bamboo 1-9, four copies each.
  - Dots 1-9, four copies each.
  - Winds: East, South, West, North, four copies each.
  - Dragons: Red, Green, White, four copies each.
  - Flowers and seasons, one copy each.

## Wall and draw rules

- The live wall is used for normal draws.
- The dead wall is used for replacement draws after flowers/seasons and Kongs.
- Flowers and seasons are immediately exposed and replaced.
- If the live wall is exhausted, the round ends as an exhaustive draw.

## Turn flow

1. Current player draws.
2. Current player discards, declares a Kong, or declares a win.
3. A discard opens a claim window.
4. Eligible players may claim Mahjong, Pong, Kong, or Chow.
5. If nobody claims, the next player draws.

## Dealer and round wind progression

- If the dealer wins, the dealer remains dealer for the next round.
- If the round ends in an exhaustive draw, the dealer remains dealer for the next round.
- If a non-dealer wins, dealership passes to the next seat in turn order.
- When dealership returns to the seat that started the current wind round, every player has had at least one dealer opportunity, so the prevailing wind advances to the next wind.
- After advancing from North, the implementation wraps to East for continued local play.

## Meld calls

- Chow can only be claimed by the next player in turn order.
- Pong can be claimed from any discard.
- Exposed Kong can be claimed from any discard when holding three matching tiles.
- Concealed Kong can be declared from four matching concealed tiles.
- Added Kong can upgrade an exposed Pong with the fourth tile.
- Kong declarations draw replacement tiles from the dead wall.

## Win shapes

Supported winning shapes:

- Standard hand: four sets and a pair.
- Seven Pairs.
- Thirteen Orphans.
- Nine Gates.
- Flower/season wins from complete flower/season collection conditions.

## Fan features

The implemented default Fan table includes:

- Seat flower.
- Seat season.
- No flowers or seasons.
- Dragon Pong/Kong.
- Seat wind Pong/Kong.
- Round wind Pong/Kong.
- All Chows.
- All Pongs.
- Mixed One Suit.
- Pure One Suit.
- Little Three Dragons.
- Big Three Dragons.
- Little Four Winds.
- Big Four Winds.
- Seven Pairs.
- Thirteen Orphans.
- All Honours.
- All Terminals.
- All Terminals and Honours.

Fan features are additive unless a higher-value feature explicitly replaces another feature or belongs to the same replacement group.

## Payment table

Default payment bands:

| Fan | Base points |
| --- | ---: |
| 0 | 1 |
| 1 | 2 |
| 2 | 4 |
| 3 | 8 |
| 4-6 | 16 |
| 7-9 | 32 |
| 10-12 | 64 |
| 13+ | 128 |

## Payment doublings

- Discard win: the discarder pays double.
- Self-pick: all losing players pay double.
- East winner: all payments double.
- East payer losing: East's payment doubles.
- Doublings stack.

## Configurable rules

- Minimum Fan is configurable.
- The Fan table is represented as data so future rule variants can adjust features or values.

## UI/privacy rule

- During active play, only the viewer's concealed hand is visible.
- Other players' concealed hands are shown as tile backs.
- When the round finishes, all hands are revealed.
- The winning tile is separated and highlighted in the winning hand.
- Payment lines are shown with payer, winner, Fan total, and point cost.
- After a win or draw, a next-round action starts a fresh wall and hand while carrying scores, controllers, names, dealer, and prevailing-wind progression forward.

## Deferred or house-rule-sensitive items

- Full match wind rotation beyond the implemented round lifecycle can be extended.
- Rare house rules such as robbing Kong and blessing variants can be expanded as configurable rules.
- Production persistence and cross-instance realtime coordination are planned in the Azure architecture but are not required for local play.
