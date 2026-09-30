/**
 * radar-satire.mjs — chronique satirique déterministe du Quotidien.
 * Voix originale : absurde, observationnelle, orale et contemplative.
 * Les sujets graves, judiciaires, de santé et politiques sont exclus.
 */
const SAFE_THEMES = new Set([
  'Mobilité & travaux','Économie & emploi','Environnement & agriculture',
  'Éducation & jeunesse','Culture & sorties','Sports','Vie locale'
]);

const SERIOUS = /(mort|décès|deces|tué|tue|meurtre|viol\b|agression|accident|incendie|disparition|blessé|blesse|victime|police|gendarmer|justice|tribunal|condamn|interpell|narcotrafic|drogue|cancer|hôpital|hopital|maladie|épidémie|epidemie)/i;
const POLITICAL = /(élection|election|maire\b|mairie|municipal|déput|deput|sénat|senat|président|president|ministre|préfecture|prefecture|parti politique|rassemblement national|\brn\b|lfi|renaissance|républicains|republicains|socialiste|gouvernement)/i;

const fold = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const clean = s => String(s ?? '').replace(/\s+/g,' ').trim();
const crop = (s,n=150) => clean(s).length>n ? clean(s).slice(0,n-1).replace(/\s+\S*$/,'')+'…' : clean(s);

function seedIndex(seed, len) {
  let n=0;
  for (const ch of String(seed)) n=(n*33+ch.charCodeAt(0))>>>0;
  return len ? n%len : 0;
}

function candidateScore(i, theme, now) {
  const age=Math.max(0,(now-Date.parse(i.publishedAt))/36e5);
  let score=Math.max(0,30-age);
  if (i.source==='presse' || i.source==='gnews') score+=25;
  if (i.tags?.includes('44') || i.local) score+=18;
  if (i.summary?.length>100) score+=8;
  if (theme==='Vie locale' || theme==='Mobilité & travaux' || theme==='Culture & sorties') score+=5;
  return score;
}

export function chooseSatireSubject(items, { themeFor, now=Date.now() }={}) {
  return (items ?? [])
    .map(item=>({item,theme:themeFor(item)}))
    .filter(({item,theme})=>{
      const hay=[item.title,item.summary,item.author,item.media].filter(Boolean).join(' ');
      return SAFE_THEMES.has(theme) && !SERIOUS.test(hay) && !POLITICAL.test(hay);
    })
    .sort((a,b)=>candidateScore(b.item,b.theme,now)-candidateScore(a.item,a.theme,now))[0] ?? null;
}

const TEMPLATES = {
  'Mobilité & travaux': {
    headlines:[
      'On voulait juste aller quelque part, c’était déjà beaucoup demander',
      'La route existe, mais elle souhaite visiblement qu’on réfléchisse avant de l’utiliser'
    ],
    deck:'Une chronique sur cette invention locale très sophistiquée : le trajet qui décide soudain de devenir une aventure intérieure.',
    body: subject => [
      `Le sujet du jour tient dans ce titre : « ${subject} ». Normalement, une route sert à relier deux endroits. C’est un concept assez simple. Mais dès qu’on ajoute des travaux, un panneau jaune et trois cônes orange, le trajet devient une expérience de développement personnel. Tu ne vas plus quelque part : tu apprends qui tu es.`,
      `Le GPS, lui, reste d’un calme insultant. « Recalcul en cours. » Évidemment. Il ne paie pas l’essence, il n’a pas promis d’être là à 18 h 30 et personne ne lui a jamais dit : « Tu pouvais pas prévoir ? » Il peut se tromper cinq fois de suite avec la confiance d’un consultant qui facture à la journée.`,
      `Ce qui est beau avec une déviation, c’est qu’elle réunit les gens. Pendant quelques minutes, tout le monde regarde le même panneau avec la même expression : celle d’une personne qui vient de comprendre qu’une flèche peut être techniquement correcte tout en étant moralement discutable.`,
      `Au fond, on croit vouloir gagner du temps. Mais la route nous rappelle parfois que le temps n’appartient à personne. Surtout entre deux feux temporaires réglés de manière à ce que tu voies très bien l’autre file avancer.`
    ]
  },
  'Économie & emploi': {
    headlines:[
      'Le marché bouge, nous aussi, mais surtout pour trouver une prise électrique',
      'Le travail cherche du monde et le monde cherche où est passée la pause de midi'
    ],
    deck:'Le petit théâtre quotidien où des entreprises cherchent des gens qui cherchent des entreprises qui cherchent encore leurs mots de passe.',
    body: subject => [
      `Aujourd’hui, le Radar tombe sur : « ${subject} ». Le monde du travail adore les phrases très précises. On « recherche un profil dynamique », comme si quelqu’un avait déjà candidaté en écrivant : « Bonjour, je suis plutôt statique mais disponible immédiatement. »`,
      `Une offre d’emploi, c’est une rencontre amoureuse à laquelle on aurait retiré tout ce qui est romantique pour ajouter Excel. L’entreprise veut quelqu’un de passionné, autonome, adaptable, ponctuel et à l’aise en équipe. En résumé : une personne qui n’a jamais eu besoin de dormir ni de chercher un câble HDMI.`,
      `De l’autre côté, le candidat dit qu’il aime les défis. C’est faux, personne n’aime vraiment les défis. Les gens aiment surtout quand les choses fonctionnent, qu’on leur explique ce qu’ils doivent faire et qu’ils peuvent rentrer chez eux avec encore un peu de cerveau disponible.`,
      `Et pourtant on recommence. Parce qu’au milieu des intitulés, des entretiens et des mots « synergie », il y a parfois un vrai métier, des collègues qu’on aime bien, et cette joie inexplicable de réussir enfin à fermer une visioconférence du premier coup.`
    ]
  },
  'Environnement & agriculture': {
    headlines:[
      'La nature poursuit son activité sans attendre la validation du comité de pilotage',
      'La météo a encore pris une décision sans consulter personne'
    ],
    deck:'Quand le territoire, les nuages, les champs et les humains essaient vaguement de se mettre d’accord sur la journée.',
    body: subject => [
      `Le sujet du jour : « ${subject} ». La nature possède une qualité assez déroutante : elle continue. On peut faire une réunion de trois heures sur l’eau, la pluie ou les sols ; pendant ce temps-là, dehors, une haie pousse sans compte rendu et un nuage change complètement le programme.`,
      `Nous, on aime prévoir. On regarde une application qui nous dit « 42 % de pluie » et on devient immédiatement expert en probabilités. Personne ne sait exactement ce que signifie 42 %, mais chacun développe une stratégie : parapluie, pas parapluie, veste qu’on regrettera à 15 heures.`,
      `Les agriculteurs, eux, savent depuis longtemps qu’un ciel ne signe aucun engagement contractuel. Il peut faire beau pendant qu’on lui demande de pleuvoir et pleuvoir exactement le jour où tout le monde avait enfin trouvé un créneau.`,
      `Peut-être que c’est pour ça qu’on regarde autant la météo : c’est l’un des derniers endroits où l’on accepte encore qu’une information puisse être très sérieuse et finir malgré tout par « normalement ».`
    ]
  },
  'Éducation & jeunesse': {
    headlines:[
      'On prépare les jeunes à l’avenir, dès qu’on aura compris le présent',
      'L’école continue de fabriquer demain avec des emplois du temps imprimés hier'
    ],
    deck:'Une chronique sur cet endroit étrange où l’on apprend à résoudre des problèmes dont l’adulte oubliera ensuite la méthode.',
    body: subject => [
      `Le sujet du jour annonce : « ${subject} ». L’école est un concept magnifique : on rassemble des jeunes pour les préparer à un monde qui change tellement vite que les adultes doivent régulièrement demander aux jeunes comment fonctionne leur téléphone.`,
      `À l’école, tout a une heure précise. La sonnerie décide quand on pense aux maths, quand on pense à l’histoire et quand on a officiellement le droit d’avoir faim. Dans la vie adulte, c’est différent : on pense à manger pendant une réunion consacrée à autre chose.`,
      `On demande aussi aux élèves de « montrer leur raisonnement ». C’est probablement la compétence la moins utilisée ensuite dans les réunions professionnelles, où quelqu’un peut dire « on va partir là-dessus » et faire disparaître vingt minutes de logique en une phrase.`,
      `Mais il reste quelque chose de très beau : chaque rentrée recommence avec des cahiers neufs et cette croyance collective qu’on peut devenir quelqu’un d’un peu différent simplement parce qu’on a acheté un stylo quatre couleurs qui fonctionne encore.`
    ]
  },
  'Culture & sorties': {
    headlines:[
      'Des gens vont sortir de chez eux volontairement, et c’est déjà un événement',
      'La culture insiste encore pour nous faire ressentir des choses sans notification'
    ],
    deck:'Concerts, expos, festivals : ces endroits où des inconnus acceptent pendant un moment d’être ensemble pour autre chose qu’une file d’attente.',
    body: subject => [
      `Aujourd’hui, on nous propose : « ${subject} ». Il existe encore des endroits où l’on paie parfois pour ne pas regarder son téléphone pendant deux heures. Ça s’appelle un concert, une pièce, une exposition. Au début c’est perturbant : le contenu ne peut pas être mis en pause et personne ne te demande d’accepter les cookies.`,
      `Dans un spectacle, une salle entière accepte la même règle : on s’assoit dans le noir et on regarde des gens faire quelque chose très sérieusement. Si on décrivait ça sans utiliser le mot « culture », ce serait inquiétant. Avec une billetterie, ça devient une soirée.`,
      `Le plus étrange, c’est le retour. On sort avec une chanson, une phrase ou une image dans la tête. Quelque chose qui ne sert à rien immédiatement. Aucun tableau de bord ne devient vert. Aucun dossier n’avance. Et pourtant on a l’impression que la journée a gagné quelques centimètres.`,
      `C’est peut-être ça, sortir : accepter qu’une soirée puisse avoir de la valeur sans améliorer notre productivité. Rien que pour cette idée, ça mérite presque de réserver.`
    ]
  },
  'Sports': {
    headlines:[
      'Des adultes poursuivent un score avec beaucoup de sérieux, et heureusement',
      'Le sport prouve encore qu’une ligne au sol peut devenir une affaire considérable'
    ],
    deck:'Une chronique sur notre besoin très humain de mettre des règles autour d’une balle, puis d’oublier toutes les autres pendant quatre-vingt-dix minutes.',
    body: subject => [
      `Le sujet du jour : « ${subject} ». Le sport commence souvent avec une idée simple : mettre quelque chose quelque part avant les autres. Ensuite on ajoute des règles, des maillots, des classements et des gens capables de discuter quinze minutes d’un geste qui a duré quatre dixièmes de seconde.`,
      `Le supporter possède une faculté admirable : il peut passer toute la semaine à expliquer que « ce n’est que du sport », puis découvrir samedi qu’un ballon légèrement trop à gauche modifie profondément son rapport à l’existence.`,
      `Sur le terrain, on demande de rester concentré, de jouer collectif et de respecter les consignes. Des principes que l’on considère révolutionnaires dès qu’on les applique dans une réunion de travail.`,
      `Et quand ça gagne, tout paraît logique. Quand ça perd, on devient soudain analyste tactique. C’est peut-être la vraie démocratisation du savoir : quatre-vingt-dix minutes suffisent pour obtenir des milliers d’entraîneurs supplémentaires.`
    ]
  },
  'Vie locale': {
    headlines:[
      'Le monde est immense, mais quelqu’un doit quand même décider où mettre le panneau',
      'La grande histoire continue, juste à côté de la salle polyvalente'
    ],
    deck:'Une chronique sur la vie locale, cet endroit où les petites choses ont la courtoisie d’être réellement près de chez nous.',
    body: subject => [
      `Le Radar a retenu aujourd’hui : « ${subject} ». C’est ça qui est fascinant avec l’actualité locale. Pendant que le monde entier produit des crises, des sommets et des graphiques, ici quelqu’un doit concrètement décider d’une heure, d’un lieu, d’une chaise et probablement de qui possède la clé.`,
      `La vie locale fonctionne beaucoup grâce à des personnes qui savent des choses extrêmement précises : à qui téléphoner, quelle porte utiliser, pourquoi la salle est fermée mardi et où se trouve la rallonge. Ce sont des compétences rarement présentes sur LinkedIn et pourtant essentielles à la civilisation.`,
      `On se moque parfois des petits événements. Mais une commune sans petits événements devient simplement un endroit où les gens dorment. Un marché, une association, un chantier ou une fête, c’est une manière de dire : il se passe quelque chose ici, et on a même prévu des barrières.`,
      `Finalement, la proximité n’est peut-être pas une question de kilomètres. C’est le moment où une information te fait penser : « Ah oui, je vois exactement où c’est. » À partir de là, ce n’est plus vraiment une nouvelle. C’est presque une conversation.`
    ]
  }
};

export function buildSatiricalArticle(items, { themeFor, now=Date.now() }={}) {
  const chosen=chooseSatireSubject(items,{themeFor,now});
  if(!chosen) return null;
  const {item,theme}=chosen;
  const template=TEMPLATES[theme] ?? TEMPLATES['Vie locale'];
  const subject=crop(item.title,155);
  const headline=template.headlines[seedIndex((item.id||item.url||subject)+'|'+now.toString().slice(0,8),template.headlines.length)];
  const paragraphs=template.body(subject);
  const words=paragraphs.join(' ').trim().split(/\s+/).filter(Boolean).length;
  return {
    sourceItemId:item.id,
    sourceUrl:item.url,
    sourceTitle:item.title,
    theme,
    headline,
    deck:template.deck,
    paragraphs,
    readMinutes:Math.max(1,Math.ceil(words/210))
  };
}
