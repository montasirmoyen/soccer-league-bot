const RUN_TYPE = process.env.RUN_TYPE || 'development';

const RAW_TEAMS = {
    // # AFCOPA

    // America

    "ARGENTINA": { ROLE_ID: { production: '1572730314604945499', development: '1573088249293971586' }, EMOJI_ID: { production: '<:argentina:1573076334169825390>', development: '<:argentina:1573073575966023720>' }, manager: null, assistantManager: null, players: [] },
    "BRAZIL": { ROLE_ID: { production: '1572730593828012112', development: '1573088282064199771' }, EMOJI_ID: { production: '<:brazil:1573076412410241114>', development: '<:brazil:1573073627677466777>' }, manager: null, assistantManager: null, players: [] },
    "CANADA": { ROLE_ID: { production: '1572730665726902382', development: '1573088305359224994' }, EMOJI_ID: { production: '<:canada:1573076373889880166>', development: '<:canada:1573073683625541703>' }, manager: null, assistantManager: null, players: [] },
    "COLOMBIA": { ROLE_ID: { production: '1572730641798135909', development: '1573088317145088201' }, EMOJI_ID: { production: '<:colombia:1573076284857122887>', development: '<:colombia:1573073715539738685>' }, manager: null, assistantManager: null, players: [] },
    "JAMAICA": { ROLE_ID: { production: '1572730212347805706', development: '1573088322060943500' }, EMOJI_ID: { production: '<:jamaica:1573076181673316443>', development: '<:jamaica:1573073762964996096>' }, manager: null, assistantManager: null, players: [] },
    "MEXICO": { ROLE_ID: { production: '1572730266521309296', development: '1573088333234577468' }, EMOJI_ID: { production: '<:mexico:1573076113188593734>', development: '<:mexico:1573073804245078159>' }, manager: null, assistantManager: null, players: [] },
    "URUGUAY": { ROLE_ID: { production: '1572731444231671990', development: '1573088340989710407' }, EMOJI_ID: { production: '<:uruguay:1573075789233127605>', development: '<:uruguay:1573074127332315156>' }, manager: null, assistantManager: null, players: [] },
    "UNITED STATES": { ROLE_ID: { production: '1572731492130492590', development: '1573088349701537963' }, EMOJI_ID: { production: '<:united_states:1573075750922227753>', development: '<:united_states:1573074175545835651>' }, manager: null, assistantManager: null, players: [] },

    // Africa

    "CAMEROON": { ROLE_ID: { production: '1572731644761088020', development: '1573088357422997654' }, EMOJI_ID: { production: '<:cameroon:1573076068074524882>', development: '<:cameroon:1573073834456653877>' }, manager: null, assistantManager: null, players: [] },
    "EGYPT": { ROLE_ID: { production: '1572731660028612698', development: '1573088364977193110' }, EMOJI_ID: { production: '<:egypt:1573075992161820892>', development: '<:egypt:1573073923040485486>' }, manager: null, assistantManager: null, players: [] },
    "GHANA": { ROLE_ID: { production: '1572731676591784017', development: '1573088373831114762' }, EMOJI_ID: { production: '<:ghana:1573076024374202498>', development: '<:ghana:1573073882120851507>' }, manager: null, assistantManager: null, players: [] },
    "IVORY COAST": { ROLE_ID: { production: '1572731689946451998', development: '1573088380047331408' }, EMOJI_ID: { production: '<:ivory_coast:1573075958083231924>', development: '<:ivory_coast:1573073956309831820>' }, manager: null, assistantManager: null, players: [] },
    "MOROCCO": { ROLE_ID: { production: '1572731705121447986', development: '1573088388163174542' }, EMOJI_ID: { production: '<:morocco:1573075925128446012>', development: '<:morocco:1573073989083861123>' }, manager: null, assistantManager: null, players: [] },
    "NIGERIA": { ROLE_ID: { production: '1572731721512910991', development: '1573088396652585100' }, EMOJI_ID: { production: '<:nigeria:1573075891809161266>', development: '<:nigeria:1573074016368074872>' }, manager: null, assistantManager: null, players: [] },
    "SENEGAL": { ROLE_ID: { production: '1572731745944477696', development: '1573088405858943156' }, EMOJI_ID: { production: '<:senegal:1573075857914732766>', development: '<:senegal:1573074064124289084>' }, manager: null, assistantManager: null, players: [] },
    "SOUTH AFRICA": { ROLE_ID: { production: '1572731758380847325', development: '1573088815227207874' }, EMOJI_ID: { production: '<:south_africa:1573075822833832067>', development: '<:south_africa:1573074096772616243>' }, manager: null, assistantManager: null, players: [] },
};

const filteredTeams = Object.fromEntries(
  Object.entries(RAW_TEAMS).map(([teamName, teamData]) => {
    return [
      teamName,
      {
        ...teamData,
        ROLE_ID: teamData.ROLE_ID[RUN_TYPE],
        EMOJI_ID: teamData.EMOJI_ID[RUN_TYPE] || null
      }
    ];
  })
);

module.exports = {
  teams: filteredTeams
};