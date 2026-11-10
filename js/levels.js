// Burggolf – Bahnen
//
// Kartenzeichen (jede Kachel ist 1×1):
//   #  Grün          T  Abschlag        H  Loch
//   ~  Wasser        :  Kies (bremst)   Leerzeichen = nichts
//   a b c d  schräge Ecken (abgeschnitten: a oben links, b oben rechts,
//            c unten rechts, d unten links)

export const COURSES = [
  {
    id: 'burghof',
    name: 'Burghof',
    holes: [
      {
        name: 'Burgtor',
        par: 2,
        hint: 'Finger ziehen wie bei einer Schleuder – loslassen zum Schlagen.',
        map: [
          '############',
          '#T########H#',
          '############',
        ],
        walls: [[6, 0, 6, 0.9], [6, 2.1, 6, 3]],
      },
      {
        name: 'Wehrgang',
        par: 2,
        hint: 'Die schräge Mauer lenkt den Ball um die Ecke.',
        map: [
          '#########b ',
          '#T########b',
          '###########',
          '        ###',
          '        ###',
          '        ###',
          '        ##H',
          '        ###',
        ],
      },
      {
        name: 'Zwei Türme',
        par: 2,
        hint: 'Der direkte Weg ist versperrt – spiel über die Bande.',
        map: [
          '#############',
          '#############',
          '#T#########H#',
          '#############',
          '#############',
        ],
        towers: [[5, 2.0, 0.65], [8.5, 3.0, 0.65]],
      },
      {
        name: 'Zugbrücke',
        par: 3,
        hint: 'Nur die Brücke führt trocken über den Burggraben.',
        map: [
          '#####~~~######',
          '#T###~~~###H##',
          '#####~~~######',
          '##############',
          '#####~~~######',
        ],
      },
      {
        name: 'Burghügel',
        par: 3,
        hint: 'Zu wenig Schwung, und der Ball rollt wieder herunter.',
        map: [
          '         #####',
          '         ##H##',
          '##############',
          '#T############',
          '##############',
          '         #####',
          '         #####',
        ],
        relief: [{ type: 'ramp', axis: 'x', from: 6, to: 8, h: 0.6 }],
      },
      {
        name: 'Fallgitter',
        par: 4,
        hint: 'Warte, bis das Gitter oben ist.',
        map: [
          '#########b ',
          '#T########b',
          '###########',
          '        ###',
          '        ###',
          '###########',
          '#H########c',
          '#########c ',
        ],
        walls: [[5, 0, 5, 0.8], [5, 2.2, 5, 3], [5, 5, 5, 5.8], [5, 7.2, 5, 8]],
        gates: [
          { seg: [5, 0.8, 5, 2.2], period: 3.4, open: 1.8, phase: 0 },
          { seg: [5, 5.8, 5, 7.2], period: 3.4, open: 1.8, phase: 1.7 },
        ],
      },
      {
        name: 'Drehkreuz',
        par: 3,
        hint: 'Durch die Mitte mit gutem Timing – oder außen herum.',
        map: [
          '###########',
          '###########',
          '#T#######H#',
          '###########',
          '###########',
        ],
        spinners: [{ x: 5.5, z: 2.5, len: 1.7, arms: 4, speed: 1.4 }],
      },
      {
        name: 'Geheimgang',
        par: 3,
        hint: 'Der dunkle Schacht in der Nische ist eine Abkürzung.',
        map: [
          '    #         ',
          '######   #####',
          '#T####   ###H#',
          '######   #####',
          '######:::#####',
          '######:::#####',
        ],
        tunnels: [{ in: [4.5, 0.42], out: [10.5, 4.5], dir: [1, -1], speed: 5 }],
      },
      {
        name: 'Thronsaal',
        par: 4,
        hint: 'Der Thron steht erhöht – und die Wache passt auf.',
        map: [
          '#######~########',
          '#######~########',
          '#######~#####H##',
          '#######~########',
          '################',
          '#T#########::###',
          '###########::###',
        ],
        towers: [[4.5, 3.6, 0.5], [8.6, 5.7, 0.45]],
        guards: [{ from: [10.3, 0.7], to: [10.3, 6.3], period: 6, r: 0.32 }],
        relief: [{ type: 'mound', x: 13.5, z: 2.5, r: 1.8, h: 0.3 }],
      },
    ],
  },
];
