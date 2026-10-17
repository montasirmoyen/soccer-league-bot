const RUN_TYPE = process.env.RUN_TYPE || 'development';

const RAW_TEAMS = {
    // Ligue Nationale

    "STADE MONTELIMAR": { ROLE_ID: { production: '1538356742704865300', development: '1558981490119811198' }, EMOJI_ID: '<:stade_montelimar:1528530008140677263>', manager: null, assistantManager: null, players: [] },
    "MONTBELIARD": { ROLE_ID: { production: '1538360226284306515', development: '1558981490119811197' }, EMOJI_ID: '<:fc_montbeliard:1528529556536033442>', manager: null, assistantManager: null, players: [] },
    "TROUVILLE": { ROLE_ID: { production: '1538360282617741493', development: '1558981490119811196' }, EMOJI_ID: '<:as_trouville:1528529734152228964>', manager: null, assistantManager: null, players: [] },
    "ORLEANS": { ROLE_ID: { production: '1538360304939966546', development: '1558981490119811195' }, EMOJI_ID: '<:us_orleans:1528529666040660109>', manager: null, assistantManager: null, players: [] },
    "SAINTCLAIR": { ROLE_ID: { production: '1538360296266006568', development: '1558981490119811194' }, EMOJI_ID: '<:es_saintclair:1538171599184863342>', manager: null, assistantManager: null, players: [] },
    "STADE VILLENEUVE": { ROLE_ID: { production: '1538359772825395310', development: '1558981490119811193' }, EMOJI_ID: '<:stade_villeneuve:1528530132036354220>', manager: null, assistantManager: null, players: [] },
    "ROCHEMONT": { ROLE_ID: { production: '1538361641454801016', development: '1558981490111549589' }, EMOJI_ID: '<:sc_rochemont:1528529412146991194>', manager: null, assistantManager: null, players: [] },
    "OLYMPIQUE RIVIERE": { ROLE_ID: { production: '1538361606914842664', development: '1558981490111549588' }, EMOJI_ID: '<:olympique_riviere:1528529786786283550>', manager: null, assistantManager: null, players: [] },

    // Liga Iberia

    "UNION CASTELLANA": { ROLE_ID: { production: '1538361592377245767', development: '1558981490111549587' }, EMOJI_ID: '<:union_castellana:1530304335165128834>', manager: null, assistantManager: null, players: [] },
    "HUESCO": { ROLE_ID: { production: '1538361622182232088', development: '1558981490111549586' }, EMOJI_ID: '<:huesco_cf:1530304560688660721>', manager: null, assistantManager: null, players: [] },
    "ILLESCAS": { ROLE_ID: { production: '1538362510040637571', development: '1558981490111549585' }, EMOJI_ID: '<:rcd_illescas:1530304238993805392>', manager: null, assistantManager: null, players: [] },
    "LUCENA": { ROLE_ID: { production: '1538362547630116954', development: '1558981490111549584' }, EMOJI_ID: '<:lucena_cf:1532053987367588001>', manager: null, assistantManager: null, players: [] },
    "VILLENA": { ROLE_ID: { production: '1538362553510404157', development: '1558981490111549583' }, EMOJI_ID: '<:cd_villena:1530304495127494746>', manager: null, assistantManager: null, players: [] },
    "PUERTO": { ROLE_ID: { production: '1538362558854209617', development: '1558981490111549582' }, EMOJI_ID: '<:puerto_fc:1532054188991971328>', manager: null, assistantManager: null, players: [] },
    "AGUILAS": { ROLE_ID: { production: '1538362584250454116', development: '1558981490111549581' }, EMOJI_ID: '<:aguilas_cf:1530304110186991898>', manager: null, assistantManager: null, players: [] },
    "ATLETICO LEON": { ROLE_ID: { production: '1538362539711275048', development: '1558981490111549580' }, EMOJI_ID: '<:atletico_leon:1530304396905418904>', manager: null, assistantManager: null, players: [] },

    // Lega Proxima

    "SIENA": { ROLE_ID: { production: '1538364378443812895', development: '1558981490077999323' }, EMOJI_ID: '<:ac_siena:1533991382769864774>', manager: null, assistantManager: null, players: [] },
    "RIETI CALCIO": { ROLE_ID: { production: '1538364394554138665', development: '1558981490077999322' }, EMOJI_ID: '<:rieti_calcio:1533990509138280638>', manager: null, assistantManager: null, players: [] },
    "CELESTE": { ROLE_ID: { production: '1538364407845752995', development: '1558981490077999321' }, EMOJI_ID: '<:us_celeste:1533990267714277446>', manager: null, assistantManager: null, players: [] },
    "VALDORIA": { ROLE_ID: { production: '1538364437373784155', development: '1558981490077999320' }, EMOJI_ID: '<:ac_valdoria:1533990219559207083>', manager: null, assistantManager: null, players: [] },
    "UNIONE VENICE": { ROLE_ID: { production: '1538364454465703998', development: '1558981490077999319' }, EMOJI_ID: '<:unione_venice:1533990459058426006>', manager: null, assistantManager: null, players: [] },
    "ALPINA ARREZO": { ROLE_ID: { production: '1538364401726525520', development: '1558981490077999318' }, EMOJI_ID: '<:alpina_arrezo:1533990787027701800>', manager: null, assistantManager: null, players: [] },
    "ROVENNA": { ROLE_ID: { production: '1538364469741355008', development: '1558981490077999317' }, EMOJI_ID: '<:ss_rovenna:1533990389361414228>', manager: null, assistantManager: null, players: [] },
    "LA FOGGIA": { ROLE_ID: { production: '1538364463395373137', development: '1558981490077999316' }, EMOJI_ID: '<:la_foggia:1533999396952342548>', manager: null, assistantManager: null, players: [] }
};

const filteredTeams = Object.fromEntries(
  Object.entries(RAW_TEAMS).map(([teamName, teamData]) => {
    return [
      teamName,
      {
        ...teamData,
        ROLE_ID: teamData.ROLE_ID[RUN_TYPE]
      }
    ];
  })
);

module.exports = {
  teams: filteredTeams
};